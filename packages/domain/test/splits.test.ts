import { describe, expect, it } from 'vitest';
import type { RightsHolderId } from '../src/ids.js';
import { money } from '../src/money.js';
import { allocate, InvalidSplitError, SPLIT_SCALE, validateSplits } from '../src/splits.js';

const h = (s: string) => s as RightsHolderId;

describe('validateSplits', () => {
  it('accepts a valid 100% split', () => {
    expect(() =>
      validateSplits([
        { holderId: h('a'), ppm: 500_000n },
        { holderId: h('b'), ppm: 500_000n },
      ]),
    ).not.toThrow();
  });

  it('accepts a single 100% holder', () => {
    expect(() => validateSplits([{ holderId: h('a'), ppm: SPLIT_SCALE }])).not.toThrow();
  });

  it('rejects empty, non-positive, duplicate, and wrong-sum splits', () => {
    expect(() => validateSplits([])).toThrow(InvalidSplitError);
    expect(() =>
      validateSplits([
        { holderId: h('a'), ppm: 0n },
        { holderId: h('b'), ppm: SPLIT_SCALE },
      ]),
    ).toThrow(InvalidSplitError);
    expect(() =>
      validateSplits([
        { holderId: h('a'), ppm: 500_000n },
        { holderId: h('a'), ppm: 500_000n },
      ]),
    ).toThrow(InvalidSplitError);
    expect(() => validateSplits([{ holderId: h('a'), ppm: 999_999n }])).toThrow(InvalidSplitError);
    expect(() =>
      validateSplits([
        { holderId: h('a'), ppm: 500_001n },
        { holderId: h('b'), ppm: 500_000n },
      ]),
    ).toThrow(InvalidSplitError);
  });
});

describe('allocate', () => {
  it('splits evenly when exact', () => {
    const result = allocate(money(100n, 'EUR'), [
      { holderId: h('a'), ppm: 500_000n },
      { holderId: h('b'), ppm: 500_000n },
    ]);
    expect(result).toEqual([
      { holderId: h('a'), amount: money(50n, 'EUR') },
      { holderId: h('b'), amount: money(50n, 'EUR') },
    ]);
  });

  it('conserves exactly on a thirds split of 100 (classic rounding trap)', () => {
    const result = allocate(money(100n, 'EUR'), [
      { holderId: h('a'), ppm: 333_334n },
      { holderId: h('b'), ppm: 333_333n },
      { holderId: h('c'), ppm: 333_333n },
    ]);
    const sum = result.reduce((acc, r) => acc + r.amount.amount, 0n);
    expect(sum).toBe(100n);
    // Largest remainder: everyone floors to 33, remainder unit goes to the largest fractional part.
    expect(result.map((r) => r.amount.amount).sort()).toEqual([33n, 33n, 34n].sort());
  });

  it('allocates 1 minor unit to exactly one holder, deterministically', () => {
    const shares = [
      { holderId: h('b'), ppm: 500_000n },
      { holderId: h('a'), ppm: 500_000n },
    ];
    const result = allocate(money(1n, 'EUR'), shares);
    // Equal remainders — tie broken by holderId, so 'a' gets the unit. Reproducible forever.
    expect(result).toEqual([
      { holderId: h('a'), amount: money(1n, 'EUR') },
      { holderId: h('b'), amount: money(0n, 'EUR') },
    ]);
  });

  it('handles zero amounts', () => {
    const result = allocate(money(0n, 'EUR'), [{ holderId: h('a'), ppm: SPLIT_SCALE }]);
    expect(result).toEqual([{ holderId: h('a'), amount: money(0n, 'EUR') }]);
  });

  it('allocates negative amounts (reversals) symmetrically', () => {
    const shares = [
      { holderId: h('a'), ppm: 333_334n },
      { holderId: h('b'), ppm: 333_333n },
      { holderId: h('c'), ppm: 333_333n },
    ];
    const pos = allocate(money(100n, 'EUR'), shares);
    const neg = allocate(money(-100n, 'EUR'), shares);
    for (let i = 0; i < pos.length; i++) {
      expect(neg[i]!.holderId).toBe(pos[i]!.holderId);
      expect(neg[i]!.amount.amount).toBe(-pos[i]!.amount.amount);
    }
  });

  it('rejects invalid split sets', () => {
    expect(() => allocate(money(100n, 'EUR'), [])).toThrow(InvalidSplitError);
    expect(() =>
      allocate(money(100n, 'EUR'), [{ holderId: h('a'), ppm: 999_999n }]),
    ).toThrow(InvalidSplitError);
  });
});
