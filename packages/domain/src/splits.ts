import type { RightsHolderId } from './ids.js';
import type { Money } from './money.js';

/**
 * Ownership shares are integer parts-per-million (ppm). 1,000,000 ppm = 100%.
 * ppm gives enough resolution for real-world music splits (0.0001%) while staying
 * exact-integer. A valid split set ALWAYS sums to exactly SPLIT_SCALE — enforced
 * here, by a deferred DB constraint trigger, and by property-based tests.
 *
 * Shares that are not exactly representable in ppm (e.g. 1/3) are entered as
 * ppm values that sum to SPLIT_SCALE (333_334 / 333_333 / 333_333); money
 * allocation then conserves totals exactly via largest-remainder rounding.
 */
export const SPLIT_SCALE = 1_000_000n;

export interface SplitShare {
  readonly holderId: RightsHolderId;
  /** Integer parts-per-million of SPLIT_SCALE. Must be > 0. */
  readonly ppm: bigint;
}

export class InvalidSplitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSplitError';
  }
}

/** Throws InvalidSplitError unless shares are non-empty, positive, unique-holder, and sum to exactly 100%. */
export function validateSplits(shares: readonly SplitShare[]): void {
  if (shares.length === 0) throw new InvalidSplitError('Split set must not be empty');
  const seen = new Set<string>();
  let sum = 0n;
  for (const s of shares) {
    if (s.ppm <= 0n) {
      throw new InvalidSplitError(`Share for ${s.holderId} must be > 0 ppm, got ${s.ppm}`);
    }
    if (seen.has(s.holderId)) {
      throw new InvalidSplitError(`Duplicate rights-holder in split set: ${s.holderId}`);
    }
    seen.add(s.holderId);
    sum += s.ppm;
  }
  if (sum !== SPLIT_SCALE) {
    throw new InvalidSplitError(`Split shares must sum to exactly ${SPLIT_SCALE} ppm (100%), got ${sum}`);
  }
}

export interface Allocation {
  readonly holderId: RightsHolderId;
  readonly amount: Money;
}

/**
 * Allocate a money amount across a valid split set.
 *
 * Guarantees (see property tests):
 *  - Conservation: allocated amounts sum to EXACTLY the input amount.
 *  - Determinism: same input → same output, independent of share ordering.
 *  - Fair rounding: largest-remainder method; ties broken by holderId (lexicographic),
 *    so the result is reproducible forever, not dependent on iteration order.
 *  - Negative amounts (reversals) allocate symmetrically: allocate(-x) = -allocate(x).
 */
export function allocate(amount: Money, shares: readonly SplitShare[]): Allocation[] {
  validateSplits(shares);

  const negative = amount.amount < 0n;
  const abs = negative ? -amount.amount : amount.amount;

  // Deterministic processing order regardless of input order.
  const ordered = [...shares].sort((a, b) =>
    a.holderId < b.holderId ? -1 : a.holderId > b.holderId ? 1 : 0,
  );

  // Floor share, then distribute the remainder one minor unit at a time,
  // largest fractional remainder first (ties: holderId order from the sort above).
  const floors = ordered.map((s) => {
    const raw = abs * s.ppm;
    return { holderId: s.holderId, floor: raw / SPLIT_SCALE, rem: raw % SPLIT_SCALE };
  });

  let leftover = abs - floors.reduce((acc, f) => acc + f.floor, 0n);

  const byRemainder = [...floors].sort((a, b) => {
    if (a.rem !== b.rem) return a.rem > b.rem ? -1 : 1;
    return a.holderId < b.holderId ? -1 : 1;
  });
  const bonus = new Set<string>();
  for (const f of byRemainder) {
    if (leftover === 0n) break;
    bonus.add(f.holderId);
    leftover -= 1n;
  }

  return floors.map((f) => {
    const units = f.floor + (bonus.has(f.holderId) ? 1n : 0n);
    return {
      holderId: f.holderId as RightsHolderId,
      amount: { amount: negative ? -units : units, currency: amount.currency },
    };
  });
}
