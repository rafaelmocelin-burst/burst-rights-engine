import type { AssetId, RightsHolderId } from './ids.js';
import { distributeExact } from './ppm.js';
import type { RuleVersion } from './rules.js';
import { SPLIT_SCALE, validateSplits, type SplitShare } from './splits.js';

/**
 * Attribution engine (Phase 3): turn a creation's recipe into fractional
 * ownership splits for the creation itself — one split set per copyright side
 * (composition and master) — deterministically and summing to exactly 100%.
 *
 * Policy v1 (ADR 0007):
 *  - If the recipe carries no ingredient with rights on a side, the creator
 *    owns 100% of that side.
 *  - Otherwise the creator keeps a policy-defined share; the remainder is the
 *    ingredient pool, divided equally among distinct contributing assets
 *    (usage kinds do not weight differently in v1), and each asset's portion
 *    flows to its rights-holders proportionally to their registered splits.
 *  - All arithmetic is exact-integer ppm via largest-remainder distribution;
 *    holders appearing via multiple assets (or as both creator and sample
 *    owner) are merged by summation.
 */

export interface AttributionPolicyV1 {
  /** Creator's retained share of the composition side when ingredients exist. */
  readonly creatorCompositionPpm: bigint;
  /** Creator's retained share of the master side when ingredients exist. */
  readonly creatorMasterPpm: bigint;
}

export const DEFAULT_ATTRIBUTION_POLICY_V1: AttributionPolicyV1 = {
  creatorCompositionPpm: 500_000n,
  creatorMasterPpm: 500_000n,
};

/** One recipe ingredient with the rights it carries, as resolved from the registry at a given instant. */
export interface AttributionIngredient {
  readonly assetId: AssetId;
  readonly compositionShares?: readonly SplitShare[];
  readonly masterShares?: readonly SplitShare[];
}

export interface AttributionInput {
  /** Rights-holder representing the creating user. */
  readonly creatorHolderId: RightsHolderId;
  readonly ingredients: readonly AttributionIngredient[];
  readonly policy: AttributionPolicyV1;
}

export interface AttributionResult {
  readonly composition: readonly SplitShare[];
  readonly master: readonly SplitShare[];
}

export class AttributionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttributionError';
  }
}

function attributeSide(
  creator: RightsHolderId,
  creatorPpm: bigint,
  contributors: readonly { assetId: AssetId; shares: readonly SplitShare[] }[],
): SplitShare[] {
  if (creatorPpm < 0n || creatorPpm > SPLIT_SCALE) {
    throw new AttributionError(`Creator share must be within [0, ${SPLIT_SCALE}] ppm, got ${creatorPpm}`);
  }
  const acc = new Map<string, bigint>();
  if (contributors.length === 0) {
    acc.set(creator, SPLIT_SCALE);
  } else {
    for (const c of contributors) validateSplits(c.shares);
    acc.set(creator, creatorPpm);
    const pool = SPLIT_SCALE - creatorPpm;
    const perAsset = distributeExact(
      pool,
      contributors.map((c) => ({ key: c.assetId, weight: 1n })),
    );
    for (const c of contributors) {
      const assetPpm = perAsset.get(c.assetId)!;
      if (assetPpm === 0n) continue;
      const perHolder = distributeExact(
        assetPpm,
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
  validateSplits(result); // conservation is structural, but verify anyway — this is money-adjacent
  return result;
}

export function attributeV1(input: AttributionInput): AttributionResult {
  const seen = new Set<string>();
  for (const ing of input.ingredients) {
    if (seen.has(ing.assetId)) {
      throw new AttributionError(`Duplicate ingredient asset: ${ing.assetId}`);
    }
    seen.add(ing.assetId);
  }
  const compContributors = input.ingredients
    .filter((i) => i.compositionShares !== undefined && i.compositionShares.length > 0)
    .map((i) => ({ assetId: i.assetId, shares: i.compositionShares! }));
  const masterContributors = input.ingredients
    .filter((i) => i.masterShares !== undefined && i.masterShares.length > 0)
    .map((i) => ({ assetId: i.assetId, shares: i.masterShares! }));

  return {
    composition: attributeSide(
      input.creatorHolderId,
      input.policy.creatorCompositionPpm,
      compContributors,
    ),
    master: attributeSide(input.creatorHolderId, input.policy.creatorMasterPpm, masterContributors),
  };
}

export const ATTRIBUTION_V1 = 'attribution/v1';

/** The versioned rule object — register in a RuleRegistry; the id is stamped on derived records. */
export const attributionRuleV1: RuleVersion<AttributionInput, AttributionResult> = {
  id: ATTRIBUTION_V1,
  apply: attributeV1,
};
