import type { RightType, UsageEvent } from './entities.js';
import type { RightsHolderId } from './ids.js';
import { allocate, SPLIT_SCALE, type SplitShare } from './splits.js';
import type { Money } from './money.js';
import type { RuleVersion } from './rules.js';

/**
 * Royalty computation (Phase 4): turn one monetary usage event into ledger
 * accrual drafts, using the creation's attributed splits.
 *
 * Policy v1 (ADR 0008): gross → platform fee (truncated toward zero, so
 * reversals mirror exactly) → net splits between the composition and master
 * pools by policy ppm → each pool allocates across its split set via the
 * conservation-exact largest-remainder allocator. By construction:
 *   platformFee + Σ entries == gross, for positive AND negative gross.
 *
 * Pure and versioned: the caller persists the drafts as append-only ledger
 * rows stamped with ROYALTY_V1. Idempotency (one computation per eventId)
 * is enforced by the store, not here.
 */

export interface RoyaltyPolicyV1 {
  /** Platform's cut of gross, in ppm. */
  readonly platformFeePpm: bigint;
  /** Share of the net that goes to the composition side; the rest goes to master. */
  readonly compositionPoolPpm: bigint;
}

export const DEFAULT_ROYALTY_POLICY_V1: RoyaltyPolicyV1 = {
  platformFeePpm: 300_000n, // 30% platform fee — business placeholder, caller-supplied in practice
  compositionPoolPpm: 500_000n, // net splits 50/50 between composition and master
};

export interface RoyaltyInput {
  readonly event: UsageEvent;
  readonly composition: readonly SplitShare[];
  readonly master: readonly SplitShare[];
  readonly policy: RoyaltyPolicyV1;
}

/** A ledger entry minus store-assigned fields (id, createdAt). */
export interface AccrualDraft {
  readonly holderId: RightsHolderId;
  readonly rightType: RightType;
  readonly amount: Money;
}

export interface RoyaltyResult {
  /** Money retained by the platform (not a rights-holder accrual in v1). */
  readonly platformFee: Money;
  readonly entries: readonly AccrualDraft[];
}

export class RoyaltyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoyaltyError';
  }
}

/** Truncate-toward-zero proportional cut — symmetric for negatives, exact for our conservation math. */
function cut(amount: bigint, ppm: bigint): bigint {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const share = (abs * ppm) / SPLIT_SCALE;
  return negative ? -share : share;
}

export function computeRoyaltyV1(input: RoyaltyInput): RoyaltyResult {
  const { event, policy } = input;
  if (event.grossAmount === undefined) {
    throw new RoyaltyError(`Usage event ${event.eventId} carries no gross amount — nothing to accrue`);
  }
  for (const [name, ppm] of [
    ['platformFeePpm', policy.platformFeePpm],
    ['compositionPoolPpm', policy.compositionPoolPpm],
  ] as const) {
    if (ppm < 0n || ppm > SPLIT_SCALE) {
      throw new RoyaltyError(`${name} must be within [0, ${SPLIT_SCALE}], got ${ppm}`);
    }
  }

  const gross = event.grossAmount;
  const feeAmount = cut(gross.amount, policy.platformFeePpm);
  const net = gross.amount - feeAmount;
  const compAmount = cut(net, policy.compositionPoolPpm);
  const masterAmount = net - compAmount;

  const entries: AccrualDraft[] = [
    ...allocate({ amount: compAmount, currency: gross.currency }, input.composition).map((al) => ({
      holderId: al.holderId,
      rightType: 'composition' as const,
      amount: al.amount,
    })),
    ...allocate({ amount: masterAmount, currency: gross.currency }, input.master).map((al) => ({
      holderId: al.holderId,
      rightType: 'master' as const,
      amount: al.amount,
    })),
  ].filter((draft) => draft.amount.amount !== 0n);

  return { platformFee: { amount: feeAmount, currency: gross.currency }, entries };
}

export const ROYALTY_V1 = 'royalty/v1';

export const royaltyRuleV1: RuleVersion<RoyaltyInput, RoyaltyResult> = {
  id: ROYALTY_V1,
  apply: computeRoyaltyV1,
};
