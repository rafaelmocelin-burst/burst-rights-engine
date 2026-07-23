import { describe, expect, it } from 'vitest';
import type { Creation } from '../src/entities.js';
import type { AssetId, CreationId, EventId, UserId, WorkId } from '../src/ids.js';
import {
  extractAssetRefsFromSnapshot,
  ingestProvenance,
  type ProvenanceDeps,
} from '../src/provenance.js';
import { InMemoryRegistry } from '../src/registry.js';

const ev = (s: string) => s as EventId;
const u = (s: string) => s as UserId;
const c = (s: string) => s as CreationId;
const a = (s: string) => s as AssetId;
const w = (s: string) => s as WorkId;

function depsWith(reg: InMemoryRegistry, creations: Creation[] = []): ProvenanceDeps {
  return {
    findCreationByEventId: (id) => creations.find((cr) => cr.eventId === id),
    assetByExternalId: (ext) => reg.assetByExternalId(ext),
  };
}

function seededRegistry(): InMemoryRegistry {
  const reg = new InMemoryRegistry();
  reg.registerWork({ id: w('work-1'), title: 'Song' });
  reg.registerAsset(
    { id: a('asset-kick'), kind: 'sample', name: 'Kick', workId: w('work-1') },
    'S_1234567890abcdef',
  );
  reg.registerAsset(
    { id: a('asset-hook'), kind: 'loop', name: 'Hook', workId: w('work-1') },
    'S_feedfacecafebeef',
  );
  return reg;
}

describe('extractAssetRefsFromSnapshot', () => {
  it('finds prefixed-GUID asset ids anywhere in a snapshot, excluding container ids', () => {
    const snapshot = {
      ID: 'ST_0011223344556677', // soundtrack container — excluded
      Tracks: [
        {
          ID: 'Track_aabbccddeeff0011', // container — excluded
          Clips: [
            { ID: 'Clip_99887766554433', SampleID: 'S_1234567890abcdef' },
            { ID: 'Clip_1122334455667788', SampleID: 'S_feedfacecafebeef' },
            { ID: 'Clip_559911', SampleID: 'S_1234567890abcdef' }, // duplicate sample
          ],
        },
      ],
      BPM: 140,
      Notes: 'free text, not an ID',
    };
    expect(extractAssetRefsFromSnapshot(snapshot)).toEqual([
      'S_1234567890abcdef',
      'S_feedfacecafebeef',
    ]);
  });

  it('returns empty for snapshots with no asset references', () => {
    expect(extractAssetRefsFromSnapshot({ BPM: 120, Tracks: [] })).toEqual([]);
    expect(extractAssetRefsFromSnapshot(null)).toEqual([]);
    expect(extractAssetRefsFromSnapshot('just a string')).toEqual([]);
  });
});

describe('ingestProvenance', () => {
  it('ingests a creation with entries resolved through the registry', () => {
    const reg = seededRegistry();
    const outcome = ingestProvenance(
      {
        eventId: ev('evt-1'),
        userId: u('user-1'),
        occurredAt: '2026-07-23T12:00:00Z',
        recipe: { Tracks: [{ Clips: [{ SampleID: 'S_1234567890abcdef' }] }] },
      },
      depsWith(reg),
      c('creation-1'),
    );
    expect(outcome.kind).toBe('ingested');
    if (outcome.kind !== 'ingested') return;
    expect(outcome.creation.eventId).toBe(ev('evt-1'));
    expect(outcome.entries).toEqual([{ assetId: a('asset-kick'), usage: 'sampled' }]);
    expect(outcome.unresolved).toEqual([]);
  });

  it('prefers canonical entries over snapshot extraction and dedupes them', () => {
    const reg = seededRegistry();
    const outcome = ingestProvenance(
      {
        eventId: ev('evt-2'),
        userId: u('user-1'),
        occurredAt: '2026-07-23T12:00:00Z',
        recipe: { irrelevant: 'S_feedfacecafebeef' },
        entries: [
          { assetExternalId: 'S_1234567890abcdef', usage: 'sampled' },
          { assetExternalId: 'S_1234567890abcdef', usage: 'sampled' }, // dupe
          { assetExternalId: 'S_1234567890abcdef', usage: 'looped' }, // same asset, different usage — kept
        ],
      },
      depsWith(reg),
      c('creation-2'),
    );
    if (outcome.kind !== 'ingested') throw new Error('expected ingest');
    expect(outcome.entries).toEqual([
      { assetId: a('asset-kick'), usage: 'sampled' },
      { assetId: a('asset-kick'), usage: 'looped' },
    ]);
  });

  it('flags unknown asset references instead of dropping them silently', () => {
    const reg = seededRegistry();
    const outcome = ingestProvenance(
      {
        eventId: ev('evt-3'),
        userId: u('user-1'),
        occurredAt: '2026-07-23T12:00:00Z',
        recipe: {
          Clips: [{ SampleID: 'S_1234567890abcdef' }, { SampleID: 'S_00000000deadbeef' }],
        },
      },
      depsWith(reg),
      c('creation-3'),
    );
    if (outcome.kind !== 'ingested') throw new Error('expected ingest');
    expect(outcome.entries).toEqual([{ assetId: a('asset-kick'), usage: 'sampled' }]);
    expect(outcome.unresolved).toEqual(['S_00000000deadbeef']);
  });

  it('is idempotent: a replayed eventId returns the existing creation, ingesting nothing', () => {
    const reg = seededRegistry();
    const first = ingestProvenance(
      {
        eventId: ev('evt-4'),
        userId: u('user-1'),
        occurredAt: '2026-07-23T12:00:00Z',
        recipe: {},
      },
      depsWith(reg),
      c('creation-4'),
    );
    if (first.kind !== 'ingested') throw new Error('expected ingest');

    const replay = ingestProvenance(
      {
        eventId: ev('evt-4'),
        userId: u('user-1'),
        occurredAt: '2026-07-23T12:00:00Z',
        recipe: {},
      },
      depsWith(reg, [first.creation]),
      c('creation-5-should-not-be-used'),
    );
    expect(replay.kind).toBe('duplicate');
    if (replay.kind !== 'duplicate') return;
    expect(replay.existing.id).toBe(c('creation-4'));
  });
});
