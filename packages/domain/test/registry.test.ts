import { describe, expect, it } from 'vitest';
import type {
  AssetId,
  RecordingId,
  RightsHolderId,
  SplitVersionId,
  WorkId,
} from '../src/ids.js';
import { InMemoryRegistry, RegistryError } from '../src/registry.js';
import { SPLIT_SCALE } from '../src/splits.js';

const w = (s: string) => s as WorkId;
const r = (s: string) => s as RecordingId;
const a = (s: string) => s as AssetId;
const h = (s: string) => s as RightsHolderId;
const sv = (s: string) => s as SplitVersionId;

function seeded(): InMemoryRegistry {
  const reg = new InMemoryRegistry();
  reg.registerWork({ id: w('work-1'), title: 'Song One' });
  reg.registerRecording({ id: r('rec-1'), workId: w('work-1'), title: 'Song One (Original Mix)' });
  reg.registerRightsHolder({ id: h('writer-1'), kind: 'writer', name: 'Alice' });
  reg.registerRightsHolder({ id: h('publisher-1'), kind: 'publisher', name: 'PubCo' });
  reg.registerRightsHolder({ id: h('label-1'), kind: 'label', name: 'LabelCo' });
  return reg;
}

describe('InMemoryRegistry — registration invariants', () => {
  it('rejects duplicate ids and unknown references', () => {
    const reg = seeded();
    expect(() => reg.registerWork({ id: w('work-1'), title: 'dup' })).toThrow(RegistryError);
    expect(() =>
      reg.registerRecording({ id: r('rec-2'), workId: w('nope'), title: 'x' }),
    ).toThrow(RegistryError);
    expect(() =>
      reg.registerAsset({ id: a('asset-1'), kind: 'sample', name: 'x' }),
    ).toThrow(RegistryError); // must link work and/or recording
    expect(() =>
      reg.registerAsset({ id: a('asset-1'), kind: 'sample', name: 'x', workId: w('nope') }),
    ).toThrow(RegistryError);
  });

  it('rejects an asset whose recording belongs to a different work', () => {
    const reg = seeded();
    reg.registerWork({ id: w('work-2'), title: 'Other Song' });
    expect(() =>
      reg.registerAsset({
        id: a('asset-1'),
        kind: 'sample',
        name: 'x',
        workId: w('work-2'),
        recordingId: r('rec-1'), // rec-1 belongs to work-1
      }),
    ).toThrow(RegistryError);
  });

  it('resolves assets by the game external id, uniquely', () => {
    const reg = seeded();
    reg.registerAsset(
      { id: a('asset-1'), kind: 'sample', name: 'Kick 808', workId: w('work-1') },
      'S_abc123',
    );
    expect(reg.assetByExternalId('S_abc123')?.id).toBe(a('asset-1'));
    expect(reg.assetByExternalId('S_missing')).toBeUndefined();
    expect(() =>
      reg.registerAsset(
        { id: a('asset-2'), kind: 'loop', name: 'dup ext', workId: w('work-1') },
        'S_abc123',
      ),
    ).toThrow(RegistryError);
  });
});

describe('InMemoryRegistry — split versioning', () => {
  it('assigns version numbers append-only and enforces the 100% invariant', () => {
    const reg = seeded();
    const v1 = reg.addSplitVersion({
      id: sv('sv-1'),
      rightType: 'composition',
      workId: w('work-1'),
      effectiveFrom: '2026-01-01T00:00:00Z',
      shares: [
        { holderId: h('writer-1'), ppm: 600_000n },
        { holderId: h('publisher-1'), ppm: 400_000n },
      ],
    });
    expect(v1.version).toBe(1);

    const v2 = reg.addSplitVersion({
      id: sv('sv-2'),
      rightType: 'composition',
      workId: w('work-1'),
      effectiveFrom: '2026-06-01T00:00:00Z',
      shares: [{ holderId: h('writer-1'), ppm: SPLIT_SCALE }],
    });
    expect(v2.version).toBe(2);

    // not summing to 100% → rejected
    expect(() =>
      reg.addSplitVersion({
        id: sv('sv-3'),
        rightType: 'composition',
        workId: w('work-1'),
        effectiveFrom: '2026-07-01T00:00:00Z',
        shares: [{ holderId: h('writer-1'), ppm: 999_999n }],
      }),
    ).toThrow();
    // unregistered holder → rejected
    expect(() =>
      reg.addSplitVersion({
        id: sv('sv-4'),
        rightType: 'composition',
        workId: w('work-1'),
        effectiveFrom: '2026-07-01T00:00:00Z',
        shares: [{ holderId: h('ghost'), ppm: SPLIT_SCALE }],
      }),
    ).toThrow(RegistryError);
    // master splits must attach to recordings, not works
    expect(() =>
      reg.addSplitVersion({
        id: sv('sv-5'),
        rightType: 'master',
        workId: w('work-1'),
        effectiveFrom: '2026-07-01T00:00:00Z',
        shares: [{ holderId: h('label-1'), ppm: SPLIT_SCALE }],
      }),
    ).toThrow(RegistryError);
  });

  it('resolves the effective version at any instant, reproducibly', () => {
    const reg = seeded();
    reg.addSplitVersion({
      id: sv('sv-1'),
      rightType: 'composition',
      workId: w('work-1'),
      effectiveFrom: '2026-01-01T00:00:00Z',
      shares: [
        { holderId: h('writer-1'), ppm: 600_000n },
        { holderId: h('publisher-1'), ppm: 400_000n },
      ],
    });
    reg.addSplitVersion({
      id: sv('sv-2'),
      rightType: 'composition',
      workId: w('work-1'),
      effectiveFrom: '2026-06-01T00:00:00Z',
      shares: [{ holderId: h('writer-1'), ppm: SPLIT_SCALE }],
    });

    const subject = { workId: w('work-1') };
    expect(reg.splitsAt('composition', subject, '2025-12-31T23:59:59Z')).toBeUndefined();
    expect(reg.splitsAt('composition', subject, '2026-03-01T00:00:00Z')?.version).toBe(1);
    // boundary instant: the new version applies exactly at its effectiveFrom
    expect(reg.splitsAt('composition', subject, '2026-06-01T00:00:00Z')?.version).toBe(2);
    expect(reg.splitsAt('composition', subject, '2026-12-01T00:00:00Z')?.version).toBe(2);
    // history stays queryable after the change — old runs reproduce
    expect(reg.splitsAt('composition', subject, '2026-03-01T00:00:00Z')?.shares).toEqual([
      { holderId: h('writer-1'), ppm: 600_000n },
      { holderId: h('publisher-1'), ppm: 400_000n },
    ]);
  });

  it('same-effectiveFrom versions resolve to the highest version number (deterministic correction)', () => {
    const reg = seeded();
    reg.addSplitVersion({
      id: sv('sv-1'),
      rightType: 'master',
      recordingId: r('rec-1'),
      effectiveFrom: '2026-01-01T00:00:00Z',
      shares: [{ holderId: h('label-1'), ppm: SPLIT_SCALE }],
    });
    reg.addSplitVersion({
      id: sv('sv-2'),
      rightType: 'master',
      recordingId: r('rec-1'),
      effectiveFrom: '2026-01-01T00:00:00Z',
      shares: [
        { holderId: h('label-1'), ppm: 800_000n },
        { holderId: h('writer-1'), ppm: 200_000n },
      ],
    });
    expect(reg.splitsAt('master', { recordingId: r('rec-1') }, '2026-02-01T00:00:00Z')?.version).toBe(2);
  });

  it('exposes effective shares through assets (composition via work, master via recording)', () => {
    const reg = seeded();
    reg.registerAsset(
      { id: a('asset-1'), kind: 'sample', name: 'Hook', workId: w('work-1'), recordingId: r('rec-1') },
      'S_hook01',
    );
    reg.addSplitVersion({
      id: sv('sv-1'),
      rightType: 'composition',
      workId: w('work-1'),
      effectiveFrom: '2026-01-01T00:00:00Z',
      shares: [{ holderId: h('writer-1'), ppm: SPLIT_SCALE }],
    });
    reg.addSplitVersion({
      id: sv('sv-2'),
      rightType: 'master',
      recordingId: r('rec-1'),
      effectiveFrom: '2026-01-01T00:00:00Z',
      shares: [{ holderId: h('label-1'), ppm: SPLIT_SCALE }],
    });

    expect(reg.compositionSharesForAsset(a('asset-1'), '2026-02-01T00:00:00Z')).toEqual([
      { holderId: h('writer-1'), ppm: SPLIT_SCALE },
    ]);
    expect(reg.masterSharesForAsset(a('asset-1'), '2026-02-01T00:00:00Z')).toEqual([
      { holderId: h('label-1'), ppm: SPLIT_SCALE },
    ]);
    expect(reg.compositionSharesForAsset(a('asset-1'), '2025-01-01T00:00:00Z')).toBeUndefined();
  });
});
