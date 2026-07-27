import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  attributeV2,
  AttributionV2Error,
  creatorSharePpm,
  DEFAULT_ATTRIBUTION_POLICY_V2,
  type SessionTelemetry,
  type V2Contributor,
} from '../src/attribution-v2.js';
import type { AiMusicianId, RightsHolderId } from '../src/ids.js';
import { InMemoryRegistry } from '../src/registry.js';
import { SPLIT_SCALE, validateSplits } from '../src/splits.js';

const h = (s: string) => s as RightsHolderId;
const policy = DEFAULT_ATTRIBUTION_POLICY_V2;

describe('creatorSharePpm', () => {
  it('uses the fallback with no telemetry or zero notes', () => {
    expect(creatorSharePpm(undefined, policy)).toBe(policy.fallbackCreatorPpm);
    expect(
      creatorSharePpm({ humanNotes: 0n, aiNotesKept: 0n, aiNotesEdited: 0n }, policy),
    ).toBe(policy.fallbackCreatorPpm);
  });

  it('hits the floor when everything is AI, the ceiling when everything is human', () => {
    expect(
      creatorSharePpm({ humanNotes: 0n, aiNotesKept: 100n, aiNotesEdited: 0n }, policy),
    ).toBe(policy.creatorFloorPpm);
    expect(
      creatorSharePpm({ humanNotes: 100n, aiNotesKept: 0n, aiNotesEdited: 0n }, policy),
    ).toBe(policy.creatorCeilingPpm);
  });

  it('credits edited AI notes as half-human (default policy)', () => {
    // 0 human, 0 kept-verbatim, all edited → ratio = 50% → midpoint of [20%, 80%] = 50%
    expect(
      creatorSharePpm({ humanNotes: 0n, aiNotesKept: 0n, aiNotesEdited: 40n }, policy),
    ).toBe(500_000n);
  });
});

describe('attributeV2 — examples', () => {
  const kickAsset: V2Contributor = {
    sourceId: 'asset-kick',
    compositionShares: [{ holderId: h('writer-1'), ppm: SPLIT_SCALE }],
    masterShares: [{ holderId: h('label-1'), ppm: SPLIT_SCALE }],
    unitsInFinalMix: 16n,
    origin: 'human_placed',
  };
  const kieku: V2Contributor = {
    sourceId: 'kieku-ada',
    compositionShares: [
      { holderId: h('artist-ada'), ppm: 800_000n },
      { holderId: h('platform'), ppm: 200_000n },
    ],
    unitsInFinalMix: 16n,
    origin: 'ai_generated',
  };

  it('flows an AI musician’s share through to its training licensors', () => {
    const result = attributeV2({
      creatorHolderId: h('user-maya'),
      // all-AI session → creator at floor (20%)
      session: { humanNotes: 0n, aiNotesKept: 50n, aiNotesEdited: 0n },
      contributors: [kickAsset, kieku],
      policy,
    });
    // composition: creator 20%, pool 80% split evenly (equal units) → 40% each;
    // kieku's 40% flows 80/20 to Ada and the platform.
    expect(result.creatorPpm).toBe(200_000n);
    expect(result.composition).toEqual([
      { holderId: h('artist-ada'), ppm: 320_000n },
      { holderId: h('platform'), ppm: 80_000n },
      { holderId: h('user-maya'), ppm: 200_000n },
      { holderId: h('writer-1'), ppm: 400_000n },
    ]);
    // master side: only the kick carries master shares → pool goes to the label.
    expect(result.master).toEqual([
      { holderId: h('label-1'), ppm: 800_000n },
      { holderId: h('user-maya'), ppm: 200_000n },
    ]);
  });

  it('parked material earns nothing: zero units drops a contributor from the pool', () => {
    const result = attributeV2({
      creatorHolderId: h('user-maya'),
      session: { humanNotes: 10n, aiNotesKept: 10n, aiNotesEdited: 0n },
      contributors: [kickAsset, { ...kieku, unitsInFinalMix: 0n }],
      policy,
    });
    expect(result.composition.some((s) => s.holderId === h('artist-ada'))).toBe(false);
  });

  it('all-zero weights return the side to the creator entirely', () => {
    const result = attributeV2({
      creatorHolderId: h('user-maya'),
      session: { humanNotes: 1n, aiNotesKept: 1n, aiNotesEdited: 0n },
      contributors: [
        { ...kickAsset, unitsInFinalMix: 0n },
        { ...kieku, unitsInFinalMix: 0n },
      ],
      policy,
    });
    expect(result.composition).toEqual([{ holderId: h('user-maya'), ppm: SPLIT_SCALE }]);
    expect(result.master).toEqual([{ holderId: h('user-maya'), ppm: SPLIT_SCALE }]);
  });

  it('no contributors at all → creator owns both sides', () => {
    const result = attributeV2({
      creatorHolderId: h('user-maya'),
      session: { humanNotes: 5n, aiNotesKept: 0n, aiNotesEdited: 0n },
      contributors: [],
      policy,
    });
    expect(result.composition).toEqual([{ holderId: h('user-maya'), ppm: SPLIT_SCALE }]);
  });

  it('weights scale with units in the final mix', () => {
    const result = attributeV2({
      creatorHolderId: h('user-maya'),
      session: { humanNotes: 0n, aiNotesKept: 1n, aiNotesEdited: 0n },
      contributors: [
        { ...kickAsset, unitsInFinalMix: 48n }, // 3× the kieku's presence
        { ...kieku, unitsInFinalMix: 16n },
      ],
      policy,
    });
    // pool 800_000: kick 600_000, kieku 200_000 (→ ada 160_000, platform 40_000)
    expect(result.composition).toEqual([
      { holderId: h('artist-ada'), ppm: 160_000n },
      { holderId: h('platform'), ppm: 40_000n },
      { holderId: h('user-maya'), ppm: 200_000n },
      { holderId: h('writer-1'), ppm: 600_000n },
    ]);
  });

  it('rejects duplicates, negative telemetry, and bad policies', () => {
    expect(() =>
      attributeV2({
        creatorHolderId: h('u'),
        contributors: [kickAsset, { ...kieku, sourceId: 'asset-kick' }],
        policy,
      }),
    ).toThrow(AttributionV2Error);
    expect(() =>
      attributeV2({
        creatorHolderId: h('u'),
        contributors: [{ ...kickAsset, unitsInFinalMix: -1n }],
        policy,
      }),
    ).toThrow(AttributionV2Error);
    expect(() =>
      attributeV2({
        creatorHolderId: h('u'),
        session: { humanNotes: -1n, aiNotesKept: 0n, aiNotesEdited: 0n },
        contributors: [],
        policy,
      }),
    ).toThrow(AttributionV2Error);
    expect(() =>
      attributeV2({
        creatorHolderId: h('u'),
        contributors: [],
        policy: { ...policy, creatorFloorPpm: 900_000n }, // floor > ceiling
      }),
    ).toThrow(AttributionV2Error);
  });
});

describe('InMemoryRegistry — AI musicians', () => {
  it('registers a Kieku with valid licensor shares over registered holders', () => {
    const reg = new InMemoryRegistry();
    reg.registerRightsHolder({ id: h('artist-ada'), kind: 'artist', name: 'Ada' });
    reg.registerAiMusician({
      id: 'kieku-ada-v1' as AiMusicianId,
      name: "Ada's Kieku",
      modelId: 'kieku-transformer',
      modelVersion: '1.0.0',
      compositionLicensorShares: [{ holderId: h('artist-ada'), ppm: SPLIT_SCALE }],
    });
    expect(reg.getAiMusician('kieku-ada-v1' as AiMusicianId)?.name).toBe("Ada's Kieku");
  });

  it('rejects unregistered licensors, invalid shares, missing sides, and duplicates', () => {
    const reg = new InMemoryRegistry();
    reg.registerRightsHolder({ id: h('artist-ada'), kind: 'artist', name: 'Ada' });
    expect(() =>
      reg.registerAiMusician({
        id: 'k1' as AiMusicianId,
        name: 'x',
        modelId: 'm',
        modelVersion: '1',
        compositionLicensorShares: [{ holderId: h('ghost'), ppm: SPLIT_SCALE }],
      }),
    ).toThrow();
    expect(() =>
      reg.registerAiMusician({
        id: 'k1' as AiMusicianId,
        name: 'x',
        modelId: 'm',
        modelVersion: '1',
        compositionLicensorShares: [{ holderId: h('artist-ada'), ppm: 1n }],
      }),
    ).toThrow();
    expect(() =>
      reg.registerAiMusician({ id: 'k1' as AiMusicianId, name: 'x', modelId: 'm', modelVersion: '1' }),
    ).toThrow();
    reg.registerAiMusician({
      id: 'k1' as AiMusicianId,
      name: 'x',
      modelId: 'm',
      modelVersion: '1',
      masterLicensorShares: [{ holderId: h('artist-ada'), ppm: SPLIT_SCALE }],
    });
    expect(() =>
      reg.registerAiMusician({
        id: 'k1' as AiMusicianId,
        name: 'dup',
        modelId: 'm',
        modelVersion: '1',
        masterLicensorShares: [{ holderId: h('artist-ada'), ppm: SPLIT_SCALE }],
      }),
    ).toThrow();
  });
});

// --- property tests ---------------------------------------------------------

const sharesArb = fc
  .integer({ min: 1, max: 5 })
  .chain((n) =>
    fc.array(fc.bigInt({ min: 1n, max: 1_000_000n }), { minLength: n, maxLength: n }).map((raw) => {
      const sum = raw.reduce((a, b) => a + b, 0n);
      const ppms = raw.map((v) => (v * SPLIT_SCALE) / sum);
      let assigned = ppms.reduce((a, b) => a + b, 0n);
      ppms[0] = ppms[0]! + (SPLIT_SCALE - assigned);
      return ppms;
    }),
  )
  .filter((ppms) => ppms.every((p) => p > 0n));

const originArb = fc.constantFrom(
  'human_placed' as const,
  'ai_generated' as const,
  'ai_generated_edited' as const,
);

const contributorsArb = fc
  .integer({ min: 0, max: 6 })
  .chain((n) =>
    fc.array(
      fc.record({
        comp: fc.option(sharesArb, { nil: undefined }),
        master: fc.option(sharesArb, { nil: undefined }),
        units: fc.bigInt({ min: 0n, max: 10_000n }),
        origin: originArb,
      }),
      { minLength: n, maxLength: n },
    ),
  )
  .map((items) =>
    items.map((item, i): V2Contributor => {
      const mk = (ppms: readonly bigint[] | undefined, side: string) =>
        ppms?.map((ppm, j) => ({ holderId: h(`holder-${side}-${i}-${j}`), ppm }));
      const comp = mk(item.comp, 'c');
      const master = mk(item.master, 'm');
      return {
        sourceId: `source-${String(i).padStart(2, '0')}`,
        unitsInFinalMix: item.units,
        origin: item.origin,
        ...(comp ? { compositionShares: comp } : {}),
        ...(master ? { masterShares: master } : {}),
      };
    }),
  );

const sessionArb: fc.Arbitrary<SessionTelemetry | undefined> = fc.option(
  fc.record({
    humanNotes: fc.bigInt({ min: 0n, max: 100_000n }),
    aiNotesKept: fc.bigInt({ min: 0n, max: 100_000n }),
    aiNotesEdited: fc.bigInt({ min: 0n, max: 100_000n }),
  }),
  { nil: undefined },
);

describe('attributeV2 — properties', () => {
  it('both sides always validate as exact-100% split sets', () => {
    fc.assert(
      fc.property(sessionArb, contributorsArb, (session, contributors) => {
        const result = attributeV2({
          creatorHolderId: h('creator'),
          ...(session ? { session } : {}),
          contributors,
          policy,
        });
        validateSplits(result.composition);
        validateSplits(result.master);
      }),
      { numRuns: 300 },
    );
  });

  it('is deterministic and independent of contributor order', () => {
    fc.assert(
      fc.property(sessionArb, contributorsArb, (session, contributors) => {
        const reversed = [...contributors].reverse();
        const a = attributeV2({
          creatorHolderId: h('creator'),
          ...(session ? { session } : {}),
          contributors,
          policy,
        });
        const b = attributeV2({
          creatorHolderId: h('creator'),
          ...(session ? { session } : {}),
          contributors: reversed,
          policy,
        });
        expect(b).toEqual(a);
      }),
      { numRuns: 200 },
    );
  });

  it('creator share is monotone: more human notes never lower it', () => {
    fc.assert(
      fc.property(
        fc.record({
          humanNotes: fc.bigInt({ min: 0n, max: 100_000n }),
          aiNotesKept: fc.bigInt({ min: 0n, max: 100_000n }),
          aiNotesEdited: fc.bigInt({ min: 0n, max: 100_000n }),
        }),
        fc.bigInt({ min: 1n, max: 10_000n }),
        (session, extraHuman) => {
          const before = creatorSharePpm(session, policy);
          const after = creatorSharePpm(
            { ...session, humanNotes: session.humanNotes + extraHuman },
            policy,
          );
          expect(after >= before).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('creator share always stays within [floor, ceiling]', () => {
    fc.assert(
      fc.property(sessionArb, (session) => {
        const ppm = creatorSharePpm(session, policy);
        expect(ppm >= policy.creatorFloorPpm).toBe(true);
        expect(ppm <= policy.creatorCeilingPpm).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});
