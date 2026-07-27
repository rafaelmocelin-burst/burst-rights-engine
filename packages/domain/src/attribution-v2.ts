import type { RightsHolderId } from './ids.js';
import { distributeExact } from './ppm.js';
import type { RuleVersion } from './rules.js';
import { SPLIT_SCALE, validateSplits, type SplitShare } from './splits.js';

/**
 * `attribution/v2` — creation-time AI-contribution attribution (ADR 0012).
 *
 * Turns ground-truth telemetry captured while the music was made into
 * ownership splits per copyright side. Three contributor classes flow into one
 * split set: the human creator, sampled/looped assets, and AI musicians —
 * whose portions flow through to the artists that licensed their training data
 * (Kieku style lineage).
 *
 * Everything is exact-integer ppm; both sides always sum to exactly 100%;
 * the computation is deterministic and order-independent (property-tested).
 */

export type ContributionOrigin = 'human_placed' | 'ai_generated' | 'ai_generated_edited';

/** Note counts observed by the instrument during the session. Never inferred. */
export interface SessionTelemetry {
  /** Notes the human played and kept. */
  readonly humanNotes: bigint;
  /** AI-emitted notes kept verbatim. */
  readonly aiNotesKept: bigint;
  /** AI-emitted notes the human then modified — a joint contribution. */
  readonly aiNotesEdited: bigint;
}

/**
 * One rights-bearing contributor to the creation: a registry asset (sample,
 * loop, stem) or an AI musician. For assets the shares are the registry's
 * effective splits; for AI musicians they are the training-licensor shares.
 */
export interface V2Contributor {
  /** Asset id or AI-musician id — must be unique within one input. */
  readonly sourceId: string;
  readonly compositionShares?: readonly SplitShare[];
  readonly masterShares?: readonly SplitShare[];
  /**
   * Integer units (e.g. beats × a fixed resolution) this contribution occupies
   * in the FINAL arrangement. Material auditioned but not kept is 0 — parked
   * material earns nothing.
   */
  readonly unitsInFinalMix: bigint;
  readonly origin: ContributionOrigin;
}

export interface AttributionPolicyV2 {
  /** Creator's minimum share when rights-bearing contributors exist — curation/arrangement credit. */
  readonly creatorFloorPpm: bigint;
  /** Creator's maximum share when rights-bearing contributors exist. */
  readonly creatorCeilingPpm: bigint;
  /** Fraction of an edited AI note credited to the human (the rest stays AI-side). */
  readonly editedNoteHumanPpm: bigint;
  /** Weight multiplier per origin applied to unitsInFinalMix. */
  readonly originWeightPpm: Readonly<Record<ContributionOrigin, bigint>>;
  /** Creator share used when session telemetry is absent or empty. */
  readonly fallbackCreatorPpm: bigint;
}

export const DEFAULT_ATTRIBUTION_POLICY_V2: AttributionPolicyV2 = {
  creatorFloorPpm: 200_000n, // 20% — the creator always curated/arranged
  creatorCeilingPpm: 800_000n, // 80% — ingredients never fully dilute to zero
  editedNoteHumanPpm: 500_000n, // an edited AI note counts half-human
  originWeightPpm: {
    human_placed: 1_000_000n,
    ai_generated: 1_000_000n,
    ai_generated_edited: 1_000_000n,
  },
  fallbackCreatorPpm: 500_000n, // v1-equivalent when no telemetry exists
};

export interface AttributionV2Input {
  readonly creatorHolderId: RightsHolderId;
  readonly session?: SessionTelemetry;
  readonly contributors: readonly V2Contributor[];
  readonly policy: AttributionPolicyV2;
}

export interface AttributionV2Result {
  readonly composition: readonly SplitShare[];
  readonly master: readonly SplitShare[];
  /** The computed creator share (ppm) before flow-through — kept for explainability. */
  readonly creatorPpm: bigint;
}

export class AttributionV2Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttributionV2Error';
  }
}

function requirePpmRange(value: bigint, name: string): void {
  if (value < 0n || value > SPLIT_SCALE) {
    throw new AttributionV2Error(`${name} must be within [0, ${SPLIT_SCALE}] ppm, got ${value}`);
  }
}

function validatePolicy(policy: AttributionPolicyV2): void {
  requirePpmRange(policy.creatorFloorPpm, 'creatorFloorPpm');
  requirePpmRange(policy.creatorCeilingPpm, 'creatorCeilingPpm');
  requirePpmRange(policy.editedNoteHumanPpm, 'editedNoteHumanPpm');
  requirePpmRange(policy.fallbackCreatorPpm, 'fallbackCreatorPpm');
  if (policy.creatorFloorPpm > policy.creatorCeilingPpm) {
    throw new AttributionV2Error('creatorFloorPpm must be <= creatorCeilingPpm');
  }
  if (
    policy.fallbackCreatorPpm < policy.creatorFloorPpm ||
    policy.fallbackCreatorPpm > policy.creatorCeilingPpm
  ) {
    throw new AttributionV2Error('fallbackCreatorPpm must lie within [floor, ceiling]');
  }
  for (const origin of ['human_placed', 'ai_generated', 'ai_generated_edited'] as const) {
    if (policy.originWeightPpm[origin] < 0n) {
      throw new AttributionV2Error(`originWeightPpm.${origin} must be >= 0`);
    }
  }
}

function validateInput(input: AttributionV2Input): void {
  validatePolicy(input.policy);
  const seen = new Set<string>();
  for (const c of input.contributors) {
    if (seen.has(c.sourceId)) {
      throw new AttributionV2Error(`Duplicate contributor source: ${c.sourceId}`);
    }
    seen.add(c.sourceId);
    if (c.unitsInFinalMix < 0n) {
      throw new AttributionV2Error(`unitsInFinalMix must be >= 0 for ${c.sourceId}`);
    }
  }
  if (input.session) {
    for (const [name, v] of [
      ['humanNotes', input.session.humanNotes],
      ['aiNotesKept', input.session.aiNotesKept],
      ['aiNotesEdited', input.session.aiNotesEdited],
    ] as const) {
      if (v < 0n) throw new AttributionV2Error(`${name} must be >= 0`);
    }
  }
}

/**
 * The creator's earned share: interpolates [floor, ceiling] by the human
 * fraction of kept notes, with edited AI notes counting partially human.
 * Monotone: more human notes can never lower the result (property-tested).
 */
export function creatorSharePpm(
  session: SessionTelemetry | undefined,
  policy: AttributionPolicyV2,
): bigint {
  const { creatorFloorPpm: floor, creatorCeilingPpm: ceiling } = policy;
  if (!session) return policy.fallbackCreatorPpm;
  const totalNotes = session.humanNotes + session.aiNotesKept + session.aiNotesEdited;
  if (totalNotes === 0n) return policy.fallbackCreatorPpm;
  // humanCredit/totalCredit in ppm, floored — both stay exact integers.
  const humanCredit =
    session.humanNotes * SPLIT_SCALE + session.aiNotesEdited * policy.editedNoteHumanPpm;
  const humanRatioPpm = humanCredit / totalNotes; // credit is already ×SCALE
  return floor + ((ceiling - floor) * humanRatioPpm) / SPLIT_SCALE;
}

function attributeSide(
  creator: RightsHolderId,
  creatorPpm: bigint,
  contributors: readonly (V2Contributor & { shares: readonly SplitShare[] })[],
  policy: AttributionPolicyV2,
): SplitShare[] {
  const acc = new Map<string, bigint>();

  const weighted = contributors
    .map((c) => ({ ...c, weight: c.unitsInFinalMix * policy.originWeightPpm[c.origin] }))
    .filter((c) => c.weight > 0n);

  if (weighted.length === 0) {
    // No rights-bearing, weight-carrying contributors on this side.
    acc.set(creator, SPLIT_SCALE);
  } else {
    for (const c of weighted) validateSplits(c.shares);
    acc.set(creator, creatorPpm);
    const pool = SPLIT_SCALE - creatorPpm;
    const perSource = distributeExact(
      pool,
      weighted.map((c) => ({ key: c.sourceId, weight: c.weight })),
    );
    for (const c of weighted) {
      const portion = perSource.get(c.sourceId)!;
      if (portion === 0n) continue;
      const perHolder = distributeExact(
        portion,
        c.shares.map((s) => ({ key: s.holderId, weight: s.ppm })),
      );
      for (const [holderId, ppm] of perHolder) {
        acc.set(holderId, (acc.get(holderId) ?? 0n) + ppm);
      }
    }
  }

  const result: SplitShare[] = [...acc.entries()]
    .filter(([, ppm]) => ppm > 0n)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([holderId, ppm]) => ({ holderId: holderId as RightsHolderId, ppm }));
  validateSplits(result);
  return result;
}

export function attributeV2(input: AttributionV2Input): AttributionV2Result {
  validateInput(input);
  const creatorPpm = creatorSharePpm(input.session, input.policy);

  const withComp = input.contributors
    .filter((c) => c.compositionShares !== undefined && c.compositionShares.length > 0)
    .map((c) => ({ ...c, shares: c.compositionShares! }));
  const withMaster = input.contributors
    .filter((c) => c.masterShares !== undefined && c.masterShares.length > 0)
    .map((c) => ({ ...c, shares: c.masterShares! }));

  return {
    composition: attributeSide(input.creatorHolderId, creatorPpm, withComp, input.policy),
    master: attributeSide(input.creatorHolderId, creatorPpm, withMaster, input.policy),
    creatorPpm,
  };
}

export const ATTRIBUTION_V2 = 'attribution/v2';

export const attributionRuleV2: RuleVersion<AttributionV2Input, AttributionV2Result> = {
  id: ATTRIBUTION_V2,
  apply: attributeV2,
};
