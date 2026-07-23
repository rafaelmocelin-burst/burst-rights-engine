import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { UsageEvent } from '../src/entities.js';
import type { CreationId, EventId, RightsHolderId } from '../src/ids.js';
import { money } from '../src/money.js';
import {
  computeRoyaltyV1,
  DEFAULT_ROYALTY_POLICY_V1,
  RoyaltyError,
} from '../src/royalty.js';
import { SPLIT_SCALE, type SplitShare } from '../src/splits.js';

const h = (s: string) => s as RightsHolderId;

function purchase(amountMinor: bigint): UsageEvent {
  return {
    eventId: 'evt-1' as EventId,
    kind: 'purchase',
    creationId: 'creation-1' as CreationId,
    occurredAt: '2026-07-23T12:00:00Z',
    grossAmount: money(amountMinor, 'EUR'),
  };
}

const soloSplit: SplitShare[] = [{ holderId: h('user-1'), ppm: SPLIT_SCALE }];

describe('computeRoyaltyV1 — examples', () => {
  it('fee, pools, and holder allocation on a simple purchase', () => {
    // €10.00 purchase, 30% fee → €7.00 net → €3.50 comp / €3.50 master
    const result = computeRoyaltyV1({
      event: purchase(1000n),
      composition: [
        { holderId: h('writer-1'), ppm: 600_000n },
        { holderId: h('user-1'), ppm: 400_000n },
      ],
      master: soloSplit,
      policy: DEFAULT_ROYALTY_POLICY_V1,
    });
    expect(result.platformFee).toEqual(money(300n, 'EUR'));
    expect(result.entries).toEqual([
      { holderId: h('user-1'), rightType: 'composition', amount: money(140n, 'EUR') },
      { holderId: h('writer-1'), rightType: 'composition', amount: money(210n, 'EUR') },
      { holderId: h('user-1'), rightType: 'master', amount: money(350n, 'EUR') },
    ]);
  });

  it('drops zero-amount entries but conserves the total', () => {
    const result = computeRoyaltyV1({
      event: purchase(1n), // 1 minor unit: fee truncates to 0, one side gets the unit
      composition: soloSplit,
      master: soloSplit,
      policy: DEFAULT_ROYALTY_POLICY_V1,
    });
    const sum = result.entries.reduce((acc, e) => acc + e.amount.amount, 0n);
    expect(result.platformFee.amount + sum).toBe(1n);
    expect(result.entries.every((e) => e.amount.amount !== 0n)).toBe(true);
  });

  it('rejects non-monetary events and out-of-range policies', () => {
    const play: UsageEvent = {
      eventId: 'evt-2' as EventId,
      kind: 'play',
      creationId: 'creation-1' as CreationId,
      occurredAt: '2026-07-23T12:00:00Z',
    };
    expect(() =>
      computeRoyaltyV1({
        event: play,
        composition: soloSplit,
        master: soloSplit,
        policy: DEFAULT_ROYALTY_POLICY_V1,
      }),
    ).toThrow(RoyaltyError);
    expect(() =>
      computeRoyaltyV1({
        event: purchase(100n),
        composition: soloSplit,
        master: soloSplit,
        policy: { platformFeePpm: SPLIT_SCALE + 1n, compositionPoolPpm: 0n },
      }),
    ).toThrow(RoyaltyError);
  });
});

// --- property tests ---------------------------------------------------------

const splitArb: fc.Arbitrary<SplitShare[]> = fc
  .integer({ min: 1, max: 8 })
  .chain((n) =>
    fc
      .array(fc.bigInt({ min: 1n, max: 1_000_000n }), { minLength: n, maxLength: n })
      .map((raw) => {
        const sum = raw.reduce((acc, v) => acc + v, 0n);
        const shares = raw.map((v, i) => ({
          holderId: h(`holder-${String(i).padStart(2, '0')}`),
          ppm: (v * SPLIT_SCALE) / sum,
        }));
        let assigned = shares.reduce((acc, s) => acc + s.ppm, 0n);
        // top up the first share so the set sums exactly (and stays > 0)
        shares[0] = { ...shares[0]!, ppm: shares[0]!.ppm + (SPLIT_SCALE - assigned) };
        return shares;
      }),
  )
  .filter((s) => s.every((x) => x.ppm > 0n));

const policyArb = fc.record({
  platformFeePpm: fc.bigInt({ min: 0n, max: SPLIT_SCALE }),
  compositionPoolPpm: fc.bigInt({ min: 0n, max: SPLIT_SCALE }),
});

const grossArb = fc.bigInt({ min: -1_000_000_000n, max: 1_000_000_000n });

describe('computeRoyaltyV1 — properties', () => {
  it('conserves money exactly: fee + entries == gross, including negative (reversal) gross', () => {
    fc.assert(
      fc.property(grossArb, splitArb, splitArb, policyArb, (gross, comp, master, policy) => {
        const result = computeRoyaltyV1({
          event: purchase(gross),
          composition: comp,
          master,
          policy,
        });
        const sum = result.entries.reduce((acc, e) => acc + e.amount.amount, 0n);
        expect(result.platformFee.amount + sum).toBe(gross);
      }),
      { numRuns: 500 },
    );
  });

  it('reversal symmetry: computing −gross negates every figure', () => {
    fc.assert(
      fc.property(grossArb, splitArb, splitArb, policyArb, (gross, comp, master, policy) => {
        const pos = computeRoyaltyV1({ event: purchase(gross), composition: comp, master, policy });
        const neg = computeRoyaltyV1({ event: purchase(-gross), composition: comp, master, policy });
        expect(neg.platformFee.amount).toBe(-pos.platformFee.amount);
        const key = (e: { holderId: string; rightType: string }) => `${e.rightType}:${e.holderId}`;
        const posMap = new Map(pos.entries.map((e) => [key(e), e.amount.amount]));
        const negMap = new Map(neg.entries.map((e) => [key(e), e.amount.amount]));
        expect(negMap.size).toBe(posMap.size);
        for (const [k, v] of posMap) expect(negMap.get(k)).toBe(-v);
      }),
      { numRuns: 300 },
    );
  });

  it('is deterministic', () => {
    fc.assert(
      fc.property(grossArb, splitArb, splitArb, policyArb, (gross, comp, master, policy) => {
        const a = computeRoyaltyV1({ event: purchase(gross), composition: comp, master, policy });
        const b = computeRoyaltyV1({ event: purchase(gross), composition: comp, master, policy });
        expect(a).toEqual(b);
      }),
      { numRuns: 200 },
    );
  });
});
