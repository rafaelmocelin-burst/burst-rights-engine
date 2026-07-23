import type {
  AssetId,
  LicenseId,
  RecordingId,
  RightsHolderId,
  SplitVersionId,
  UserId,
  WorkId,
} from '@burst/domain';
import { SPLIT_SCALE } from '@burst/domain';
import type { Principal, TokenVerifier } from '../src/auth.js';
import { InMemoryStore } from '../src/adapters/memory-store.js';
import type { RouterDeps } from '../src/router.js';

/** Verifier that accepts 'user:<id>' and 'service:<id>' tokens — tests only. */
export const testVerifier: TokenVerifier = {
  async verify(token: string): Promise<Principal> {
    const [kind, id] = token.split(':');
    if ((kind !== 'user' && kind !== 'service') || !id) throw new Error('bad test token');
    return { userId: id as UserId, isService: kind === 'service' };
  },
};

export function makeDeps(store = new InMemoryStore(() => '2026-07-15T12:00:00.000Z')): RouterDeps & {
  store: InMemoryStore;
} {
  let counter = 0;
  return {
    store,
    verifier: testVerifier,
    newId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
  };
}

/**
 * Seeds a registry with one licensed stem: composition split 50/50 between a
 * writer and a publisher, master wholly owned by a label.
 */
export function seedLicensedStem(store: InMemoryStore): {
  assetExternalId: string;
  assetId: AssetId;
  writerId: RightsHolderId;
  publisherId: RightsHolderId;
  labelId: RightsHolderId;
} {
  const workId = 'work-hook' as WorkId;
  const recordingId = 'rec-hook' as RecordingId;
  const assetId = 'asset-hook' as AssetId;
  const writerId = 'holder-writer' as RightsHolderId;
  const publisherId = 'holder-publisher' as RightsHolderId;
  const labelId = 'holder-label' as RightsHolderId;

  store.registry.registerWork({ id: workId, title: 'Neon Hook' });
  store.registry.registerRecording({ id: recordingId, workId, title: 'Neon Hook (Stem)' });
  store.registry.registerRightsHolder({ id: writerId, kind: 'writer', name: 'Ada' });
  store.registry.registerRightsHolder({ id: publisherId, kind: 'publisher', name: 'North Pub' });
  store.registry.registerRightsHolder({ id: labelId, kind: 'label', name: 'Blue Label' });
  store.registry.registerAsset(
    { id: assetId, kind: 'stem', name: 'Neon Hook stem', workId, recordingId },
    'S_neonhook12345678',
  );
  store.registry.addSplitVersion({
    id: 'sv-comp' as SplitVersionId,
    rightType: 'composition',
    workId,
    effectiveFrom: '2026-01-01T00:00:00Z',
    shares: [
      { holderId: writerId, ppm: 500_000n },
      { holderId: publisherId, ppm: 500_000n },
    ],
  });
  store.registry.addSplitVersion({
    id: 'sv-master' as SplitVersionId,
    rightType: 'master',
    recordingId,
    effectiveFrom: '2026-01-01T00:00:00Z',
    shares: [{ holderId: labelId, ppm: SPLIT_SCALE }],
  });
  store.addLicense({
    id: 'lic-1' as LicenseId,
    assetId,
    territories: [],
    allowedUses: ['in_game_creation', 'streaming', 'purchase'],
    revenueSharePpm: 0n,
    validFrom: '2026-01-01T00:00:00Z',
  });

  return { assetExternalId: 'S_neonhook12345678', assetId, writerId, publisherId, labelId };
}
