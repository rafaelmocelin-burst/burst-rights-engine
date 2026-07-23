import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { RightsHolderId } from '../src/ids.js';
import { money } from '../src/money.js';
import { allocate, SPLIT_SCALE, type SplitShare } from '../src/splits.js';

/**
 * Property-based tests for the two invariants everything else rests on
 * (charter §6): money is conserved exactly, and results are deterministic
 * and order-independent. These MUST stay green on every commit.
 */

/** Arbitrary valid split set: 1–12 distinct holders, positive ppm summing to exactly SPLIT_SCALE. */
const validSplitsArb: fc.Arbitrary<SplitShare[]> = fc
  .integer({ min: 1, max: 12 })
  .chain((n) =>
    fc
      .array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: n, maxLength: n })
      .map((weights) => {
        const totalWeight = weights.reduce((a, b) => a + b, 0);
        // Convert weights → ppm by largest-remainder so they sum to exactly SPLIT_SCALE.
        const raw = weights.map((w) => (BigInt(w) * SPLIT_SCALE) / BigInt(totalWeight));
        let leftover = SPLIT_SCALE - raw.reduce((a, b) => a + b, 0n);
        const shares: SplitShare[] = [];
        for (let i = 0; i < n; i++) {
          let ppm = raw[i]!;
          if (leftover > 0n) {
            ppm += 1n;
            leftover -= 1n;
          }
          shares.push({
            holderId: `holder-${String(i).padStart(2, '0')}` as RightsHolderId,
            ppm,
          });
        }
        // Weight conversion can floor a small weight to 0 ppm; bump from the largest share.
        for (const s of shares) {
          if (s.ppm === 0n) {
            const largest = shares.reduce((a, b) => (a.ppm >= b.ppm ? a : b));
            (largest as { ppm: bigint }).ppm -= 1n;
            (s as { ppm: bigint }).ppm = 1n;
          }
        }
        return shares;
      }),
  );

const amountArb = fc
  .bigInt({ min: -1_000_000_000_000n, max: 1_000_000_000_000n })
  .map((a) => money(a, 'EUR'));

describe('allocate — properties', () => {
  it('conserves money exactly: allocations sum to the input amount', () => {
    fc.assert(
      fc.property(amountArb, validSplitsArb, (amount, shares) => {
        const result = allocate(amount, shares);
        const sum = result.reduce((acc, r) => acc + r.amount.amount, 0n);
        expect(sum).toBe(amount.amount);
      }),
      { numRuns: 500 },
    );
  });

  it('is deterministic and independent of share ordering', () => {
    fc.assert(
      fc.property(
        amountArb,
        validSplitsArb,
        fc.array(fc.nat(), { minLength: 0, maxLength: 24 }),
        (amount, shares, seedSwaps) => {
          const shuffled = [...shares];
          for (const s of seedSwaps) {
            const i = s % shuffled.length;
            const j = (s * 7 + 3) % shuffled.length;
            [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
          }
          expect(allocate(amount, shuffled)).toEqual(allocate(amount, shares));
        },
      ),
      { numRuns: 300 },
    );
  });

  it('never differs from the exact proportional amount by 1 minor unit or more per holder', () => {
    fc.assert(
      fc.property(amountArb, validSplitsArb, (amount, shares) => {
        const result = allocate(amount, shares);
        const byHolder = new Map(result.map((r) => [r.holderId, r.amount.amount]));
        for (const s of shares) {
          const exactScaled = amount.amount * s.ppm; // exact value × SPLIT_SCALE
          const gotScaled = byHolder.get(s.holderId)! * SPLIT_SCALE;
          const diff = gotScaled - exactScaled;
          const absDiff = diff < 0n ? -diff : diff;
          // |allocated − exact| < 1 full minor unit
          expect(absDiff < SPLIT_SCALE).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('reversal symmetry: allocate(−x) = −allocate(x)', () => {
    fc.assert(
      fc.property(amountArb, validSplitsArb, (amount, shares) => {
        const pos = allocate(amount, shares);
        const neg = allocate(money(-amount.amount, 'EUR'), shares);
        expect(neg.map((r) => ({ ...r, amount: { ...r.amount, amount: -r.amount.amount } }))).toEqual(pos);
      }),
      { numRuns: 300 },
    );
  });
});
