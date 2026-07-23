import { describe, expect, it } from 'vitest';
import { attributeV1, DEFAULT_ATTRIBUTION_POLICY_V1 } from '../src/attribution.js';
import type {
  AssetId,
  CreationId,
  EventId,
  RecordingId,
  RightsHolderId,
  SplitVersionId,
  UserId,
  WorkId,
} from '../src/ids.js';
import { money } from '../src/money.js';
import { ingestProvenance } from '../src/provenance.js';
import { InMemoryRegistry } from '../src/registry.js';
import { computeRoyaltyV1, DEFAULT_ROYALTY_POLICY_V1 } from '../src/royalty.js';
import { SPLIT_SCALE } from '../src/splits.js';

/**
 * The full automatic-attribution chain, no manual clearing anywhere:
 * registry → provenance ingestion (from a game-shaped snapshot) →
 * attribution → royalty accrual. This is the story the EIC demo tells,
 * in one deterministic test.
 */
describe('end to end: snapshot → provenance → attribution → royalties', () => {
  it('a purchase of a creation sampling a licensed track pays every holder correctly', () => {
    const w = (s: string) => s as WorkId;
    const r = (s: string) => s as RecordingId;
    const a = (s: string) => s as AssetId;
    const h = (s: string) => s as RightsHolderId;

    // --- Phase 1: registry ---------------------------------------------------
    const reg = new InMemoryRegistry();
    reg.registerWork({ id: w('work-hook'), title: 'Neon Hook' });
    reg.registerRecording({ id: r('rec-hook'), workId: w('work-hook'), title: 'Neon Hook (Stem)' });
    reg.registerRightsHolder({ id: h('writer-ada'), kind: 'writer', name: 'Ada' });
    reg.registerRightsHolder({ id: h('pub-north'), kind: 'publisher', name: 'North Publishing' });
    reg.registerRightsHolder({ id: h('label-blue'), kind: 'label', name: 'Blue Label' });
    reg.registerRightsHolder({ id: h('user-maya'), kind: 'user', name: 'Maya' });
    reg.registerAsset(
      {
        id: a('asset-hook'),
        kind: 'stem',
        name: 'Neon Hook stem',
        workId: w('work-hook'),
        recordingId: r('rec-hook'),
      },
      'S_neonhook12345678',
    );
    reg.addSplitVersion({
      id: 'sv-comp' as SplitVersionId,
      rightType: 'composition',
      workId: w('work-hook'),
      effectiveFrom: '2026-01-01T00:00:00Z',
      shares: [
        { holderId: h('writer-ada'), ppm: 500_000n },
        { holderId: h('pub-north'), ppm: 500_000n },
      ],
    });
    reg.addSplitVersion({
      id: 'sv-master' as SplitVersionId,
      rightType: 'master',
      recordingId: r('rec-hook'),
      effectiveFrom: '2026-01-01T00:00:00Z',
      shares: [{ holderId: h('label-blue'), ppm: SPLIT_SCALE }],
    });

    // --- Phase 2: ingest a game-shaped snapshot ------------------------------
    const outcome = ingestProvenance(
      {
        eventId: 'evt-prov-1' as EventId,
        userId: 'user-maya' as UserId,
        externalCreationId: 'ST_mayatrack001',
        occurredAt: '2026-07-01T10:00:00Z',
        recipe: {
          ID: 'ST_mayatrack001',
          Tracks: [
            { ID: 'Track_aa11', Clips: [{ ID: 'Clip_bb22', SampleID: 'S_neonhook12345678' }] },
          ],
        },
      },
      {
        findCreationByEventId: () => undefined,
        assetByExternalId: (ext) => reg.assetByExternalId(ext),
      },
      'creation-maya-1' as CreationId,
    );
    if (outcome.kind !== 'ingested') throw new Error('expected ingest');
    expect(outcome.unresolved).toEqual([]);

    // --- Phase 3: attribution ------------------------------------------------
    const at = outcome.creation.createdAt;
    const attribution = attributeV1({
      creatorHolderId: h('user-maya'),
      ingredients: outcome.entries.map((e) => {
        const comp = reg.compositionSharesForAsset(e.assetId, at);
        const master = reg.masterSharesForAsset(e.assetId, at);
        return {
          assetId: e.assetId,
          ...(comp ? { compositionShares: comp } : {}),
          ...(master ? { masterShares: master } : {}),
        };
      }),
      policy: DEFAULT_ATTRIBUTION_POLICY_V1,
    });
    // Creator keeps 50%; the sampled stem's holders share the other 50% per side.
    expect(attribution.composition).toEqual([
      { holderId: h('pub-north'), ppm: 250_000n },
      { holderId: h('user-maya'), ppm: 500_000n },
      { holderId: h('writer-ada'), ppm: 250_000n },
    ]);
    expect(attribution.master).toEqual([
      { holderId: h('label-blue'), ppm: 500_000n },
      { holderId: h('user-maya'), ppm: 500_000n },
    ]);

    // --- Phase 4: a €9.99 purchase accrues royalties -------------------------
    const result = computeRoyaltyV1({
      event: {
        eventId: 'evt-buy-1' as EventId,
        kind: 'purchase',
        creationId: outcome.creation.id,
        occurredAt: '2026-07-15T20:00:00Z',
        grossAmount: money(999n, 'EUR'),
        territory: 'FI',
      },
      composition: attribution.composition,
      master: attribution.master,
      policy: DEFAULT_ROYALTY_POLICY_V1,
    });

    // 999 → fee 299 → net 700 → comp 350 / master 350
    expect(result.platformFee).toEqual(money(299n, 'EUR'));
    expect(result.entries).toEqual([
      { holderId: h('pub-north'), rightType: 'composition', amount: money(88n, 'EUR') },
      { holderId: h('user-maya'), rightType: 'composition', amount: money(175n, 'EUR') },
      { holderId: h('writer-ada'), rightType: 'composition', amount: money(87n, 'EUR') },
      { holderId: h('label-blue'), rightType: 'master', amount: money(175n, 'EUR') },
      { holderId: h('user-maya'), rightType: 'master', amount: money(175n, 'EUR') },
    ]);
    const sum = result.entries.reduce((acc, e) => acc + e.amount.amount, 0n);
    expect(result.platformFee.amount + sum).toBe(999n); // conservation, end to end

    // A full refund clears everything to zero, entry for entry.
    const refund = computeRoyaltyV1({
      event: {
        eventId: 'evt-refund-1' as EventId,
        kind: 'purchase',
        creationId: outcome.creation.id,
        occurredAt: '2026-07-16T09:00:00Z',
        grossAmount: money(-999n, 'EUR'),
        territory: 'FI',
      },
      composition: attribution.composition,
      master: attribution.master,
      policy: DEFAULT_ROYALTY_POLICY_V1,
    });
    const refundSum = refund.entries.reduce((acc, e) => acc + e.amount.amount, 0n);
    expect(refund.platformFee.amount + refundSum).toBe(-999n);
    expect(refund.entries.map((e) => e.amount.amount)).toEqual(
      result.entries.map((e) => -e.amount.amount),
    );
  });
});
