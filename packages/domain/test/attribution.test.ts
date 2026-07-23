import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  attributeV1,
  AttributionError,
  DEFAULT_ATTRIBUTION_POLICY_V1,
  type AttributionIngredient,
} from '../src/attribution.js';
import type { AssetId, RightsHolderId } from '../src/ids.js';
import { SPLIT_SCALE, validateSplits } from '../src/splits.js';

const h = (s: string) => s as RightsHolderId;
const a = (s: string) => s as AssetId;

const policy = DEFAULT_ATTRIBUTION_POLICY_V1;

describe('attributeV1 — examples', () => {
  it('creator owns 100% of both sides when the recipe has no rights-bearing ingredients', () => {
    const result = attributeV1({ creatorHolderId: h('user-1'), ingredients: [], policy });
    expect(result.composition).toEqual([{ holderId: h('user-1'), ppm: SPLIT_SCALE }]);
    expect(result.master).toEqual([{ holderId: h('user-1'), ppm: SPLIT_SCALE }]);
  });

  it('splits the ingredient pool equally across assets, then by registered shares', () => {
    const result = attributeV1({
      creatorHolderId: h('user-1'),
      ingredients: [
        {
          assetId: a('asset-1'),
          compositionShares: [
            { holderId: h('writer-1'), ppm: 600_000n },
            { holderId: h('publisher-1'), ppm: 400_000n },
          ],
        },
        {
          assetId: a('asset-2'),
          compositionShares: [{ holderId: h('writer-2'), ppm: SPLIT_SCALE }],
        },
      ],
      policy,
    });
    // creator 50%; pool 50% → 25% per asset; asset-1: writer-1 15% / publisher-1 10%.
    expect(result.composition).toEqual([
      { holderId: h('publisher-1'), ppm: 100_000n },
      { holderId: h('user-1'), ppm: 500_000n },
      { holderId: h('writer-1'), ppm: 150_000n },
      { holderId: h('writer-2'), ppm: 250_000n },
    ]);
    // no master-bearing ingredients → creator owns the master side fully
    expect(result.master).toEqual([{ holderId: h('user-1'), ppm: SPLIT_SCALE }]);
  });

  it('merges a holder appearing through multiple assets (and as creator)', () => {
    const result = attributeV1({
      creatorHolderId: h('user-1'),
      ingredients: [
        { assetId: a('asset-1'), masterShares: [{ holderId: h('user-1'), ppm: SPLIT_SCALE }] },
        { assetId: a('asset-2'), masterShares: [{ holderId: h('label-1'), ppm: SPLIT_SCALE }] },
      ],
      policy,
    });
    expect(result.master).toEqual([
      { holderId: h('label-1'), ppm: 250_000n },
      { holderId: h('user-1'), ppm: 750_000n },
    ]);
  });

  it('handles pools that do not divide evenly across assets (exact conservation)', () => {
    const ingredients: AttributionIngredient[] = ['x', 'y', 'z'].map((k) => ({
      assetId: a(`asset-${k}`),
      compositionShares: [{ holderId: h(`writer-${k}`), ppm: SPLIT_SCALE }],
    }));
    const result = attributeV1({ creatorHolderId: h('user-1'), ingredients, policy });
    // pool 500_000 across 3 assets → 166_667 / 166_667 / 166_666 by largest remainder, tie → key order
    const sum = result.composition.reduce((acc, s) => acc + s.ppm, 0n);
    expect(sum).toBe(SPLIT_SCALE);
    expect(result.composition).toEqual([
      { holderId: h('user-1'), ppm: 500_000n },
      { holderId: h('writer-x'), ppm: 166_667n },
      { holderId: h('writer-y'), ppm: 166_667n },
      { holderId: h('writer-z'), ppm: 166_666n },
    ]);
  });

  it('rejects duplicate ingredient assets and invalid policies', () => {
    expect(() =>
      attributeV1({
        creatorHolderId: h('user-1'),
        ingredients: [
          { assetId: a('asset-1'), compositionShares: [{ holderId: h('w'), ppm: SPLIT_SCALE }] },
          { assetId: a('asset-1'), compositionShares: [{ holderId: h('w'), ppm: SPLIT_SCALE }] },
        ],
        policy,
      }),
    ).toThrow(AttributionError);
    expect(() =>
      attributeV1({
        creatorHolderId: h('user-1'),
        ingredients: [
          { assetId: a('asset-1'), compositionShares: [{ holderId: h('w'), ppm: SPLIT_SCALE }] },
        ],
        policy: { creatorCompositionPpm: SPLIT_SCALE + 1n, creatorMasterPpm: 0n },
      }),
    ).toThrow(AttributionError);
  });
});

// --- property tests ---------------------------------------------------------

const sharesArb = fc
  .integer({ min: 1, max: 6 })
  .chain((n) =>
    fc.array(fc.bigInt({ min: 1n, max: 1_000_000n }), { minLength: n, maxLength: n }).map((raw) => {
      const sum = raw.reduce((acc, v) => acc + v, 0n);
      let assigned = 0n;
      return raw.map((v, i) => {
        const isLast = i === raw.length - 1;
        const ppm = isLast ? SPLIT_SCALE - assigned : (v * SPLIT_SCALE) / sum || 1n;
        assigned += ppm;
        return ppm;
      });
    }),
  )
  .filter((ppms) => ppms.every((p) => p > 0n) && ppms.reduce((a, b) => a + b, 0n) === SPLIT_SCALE);

const ingredientsArb = fc
  .integer({ min: 0, max: 8 })
  .chain((n) =>
    fc.array(
      fc.record({
        comp: fc.option(sharesArb, { nil: undefined }),
        master: fc.option(sharesArb, { nil: undefined }),
      }),
      { minLength: n, maxLength: n },
    ),
  )
  .map((items) =>
    items.map((item, i): AttributionIngredient => {
      const mk = (ppms: readonly bigint[] | undefined, side: string) =>
        ppms?.map((ppm, j) => ({ holderId: h(`holder-${side}-${i}-${j}`), ppm }));
      const comp = mk(item.comp, 'c');
      const master = mk(item.master, 'm');
      return {
        assetId: a(`asset-${String(i).padStart(2, '0')}`),
        ...(comp ? { compositionShares: comp } : {}),
        ...(master ? { masterShares: master } : {}),
      };
    }),
  );

const policyArb = fc.record({
  creatorCompositionPpm: fc.bigInt({ min: 0n, max: SPLIT_SCALE }),
  creatorMasterPpm: fc.bigInt({ min: 0n, max: SPLIT_SCALE }),
});

describe('attributeV1 — properties', () => {
  it('both sides always validate as exact-100% split sets', () => {
    fc.assert(
      fc.property(ingredientsArb, policyArb, (ingredients, pol) => {
        const result = attributeV1({ creatorHolderId: h('creator'), ingredients, policy: pol });
        validateSplits(result.composition);
        validateSplits(result.master);
      }),
      { numRuns: 300 },
    );
  });

  it('is deterministic and independent of ingredient order', () => {
    fc.assert(
      fc.property(ingredientsArb, policyArb, (ingredients, pol) => {
        const reversed = [...ingredients].reverse();
        expect(
          attributeV1({ creatorHolderId: h('creator'), ingredients: reversed, policy: pol }),
        ).toEqual(attributeV1({ creatorHolderId: h('creator'), ingredients, policy: pol }));
      }),
      { numRuns: 200 },
    );
  });
});
