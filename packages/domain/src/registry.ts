import type {
  AiMusician,
  Asset,
  Recording,
  RightsHolder,
  RightType,
  SplitVersion,
  Work,
} from './entities.js';
import type {
  AiMusicianId,
  AssetId,
  RecordingId,
  RightsHolderId,
  SplitVersionId,
  WorkId,
} from './ids.js';
import { validateSplits, type SplitShare } from './splits.js';

/**
 * Rights registry (Phase 1): works, recordings, assets, rights-holders, and
 * versioned ownership splits, with the invariants from the charter:
 *   - splits always sum to exactly 100% (validated on every version)
 *   - split history is append-only; changes create a NEW version
 *   - resolution is deterministic: the effective version at any instant is
 *     reproducible forever
 *
 * This in-memory implementation IS the domain semantics; the Postgres adapter
 * (API layer, later phase) must behave identically — the tests here are the
 * contract.
 */

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}

export interface SplitVersionProposal {
  readonly id: SplitVersionId;
  readonly rightType: RightType;
  readonly workId?: WorkId;
  readonly recordingId?: RecordingId;
  readonly effectiveFrom: string;
  readonly shares: readonly SplitShare[];
}

function subjectKey(rightType: RightType, workId?: WorkId, recordingId?: RecordingId): string {
  return `${rightType}:${workId ?? ''}:${recordingId ?? ''}`;
}

function parseInstant(iso: string, what: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new RegistryError(`${what} is not a valid ISO 8601 instant: ${iso}`);
  return t;
}

export class InMemoryRegistry {
  private readonly works = new Map<WorkId, Work>();
  private readonly recordings = new Map<RecordingId, Recording>();
  private readonly holders = new Map<RightsHolderId, RightsHolder>();
  private readonly assets = new Map<AssetId, Asset>();
  private readonly assetsByExternalId = new Map<string, AssetId>();
  private readonly splitVersions = new Map<string, SplitVersion[]>(); // subjectKey → versions asc
  private readonly aiMusicians = new Map<AiMusicianId, AiMusician>();

  registerWork(work: Work): void {
    if (this.works.has(work.id)) throw new RegistryError(`Work already registered: ${work.id}`);
    this.works.set(work.id, work);
  }

  registerRecording(recording: Recording): void {
    if (this.recordings.has(recording.id)) {
      throw new RegistryError(`Recording already registered: ${recording.id}`);
    }
    if (!this.works.has(recording.workId)) {
      throw new RegistryError(`Recording ${recording.id} references unknown work ${recording.workId}`);
    }
    this.recordings.set(recording.id, recording);
  }

  registerRightsHolder(holder: RightsHolder): void {
    if (this.holders.has(holder.id)) {
      throw new RegistryError(`Rights-holder already registered: ${holder.id}`);
    }
    this.holders.set(holder.id, holder);
  }

  /** externalId is the game's prefixed-GUID string id (e.g. 'S_…'); unique when present. */
  registerAsset(asset: Asset, externalId?: string): void {
    if (this.assets.has(asset.id)) throw new RegistryError(`Asset already registered: ${asset.id}`);
    if (asset.workId === undefined && asset.recordingId === undefined) {
      throw new RegistryError(`Asset ${asset.id} must link a work and/or a recording`);
    }
    if (asset.workId !== undefined && !this.works.has(asset.workId)) {
      throw new RegistryError(`Asset ${asset.id} references unknown work ${asset.workId}`);
    }
    if (asset.recordingId !== undefined) {
      const rec = this.recordings.get(asset.recordingId);
      if (!rec) throw new RegistryError(`Asset ${asset.id} references unknown recording ${asset.recordingId}`);
      if (asset.workId !== undefined && rec.workId !== asset.workId) {
        throw new RegistryError(
          `Asset ${asset.id}: recording ${asset.recordingId} belongs to work ${rec.workId}, not ${asset.workId}`,
        );
      }
    }
    if (externalId !== undefined) {
      if (this.assetsByExternalId.has(externalId)) {
        throw new RegistryError(`External asset id already registered: ${externalId}`);
      }
      this.assetsByExternalId.set(externalId, asset.id);
    }
    this.assets.set(asset.id, asset);
  }

  /**
   * Append a new split version for a subject. Version numbers are assigned here
   * (max existing + 1) — callers never pick them. Every share's holder must be
   * registered, and shares must sum to exactly 100%.
   */
  addSplitVersion(proposal: SplitVersionProposal): SplitVersion {
    if ((proposal.workId === undefined) === (proposal.recordingId === undefined)) {
      throw new RegistryError('Split version must target exactly one of workId | recordingId');
    }
    if (proposal.rightType === 'composition') {
      if (proposal.workId === undefined) {
        throw new RegistryError('Composition splits attach to a work');
      }
      if (!this.works.has(proposal.workId)) {
        throw new RegistryError(`Unknown work: ${proposal.workId}`);
      }
    } else {
      if (proposal.recordingId === undefined) {
        throw new RegistryError('Master splits attach to a recording');
      }
      if (!this.recordings.has(proposal.recordingId)) {
        throw new RegistryError(`Unknown recording: ${proposal.recordingId}`);
      }
    }
    validateSplits(proposal.shares);
    for (const share of proposal.shares) {
      if (!this.holders.has(share.holderId)) {
        throw new RegistryError(`Split references unregistered rights-holder: ${share.holderId}`);
      }
    }
    parseInstant(proposal.effectiveFrom, 'effectiveFrom');

    const key = subjectKey(proposal.rightType, proposal.workId, proposal.recordingId);
    const existing = this.splitVersions.get(key) ?? [];
    const version: SplitVersion = {
      id: proposal.id,
      rightType: proposal.rightType,
      ...(proposal.workId !== undefined ? { workId: proposal.workId } : {}),
      ...(proposal.recordingId !== undefined ? { recordingId: proposal.recordingId } : {}),
      version: existing.length === 0 ? 1 : existing[existing.length - 1]!.version + 1,
      effectiveFrom: proposal.effectiveFrom,
      shares: [...proposal.shares],
    };
    this.splitVersions.set(key, [...existing, version]);
    return version;
  }

  /**
   * The split version in effect at instant `at`: among versions with
   * effectiveFrom <= at, the one with the latest effectiveFrom; ties broken by
   * highest version number. Undefined if no version was effective yet.
   */
  splitsAt(
    rightType: RightType,
    subject: { workId?: WorkId; recordingId?: RecordingId },
    at: string,
  ): SplitVersion | undefined {
    const t = parseInstant(at, 'at');
    const versions = this.splitVersions.get(subjectKey(rightType, subject.workId, subject.recordingId)) ?? [];
    let best: SplitVersion | undefined;
    let bestT = Number.NEGATIVE_INFINITY;
    for (const v of versions) {
      const vt = parseInstant(v.effectiveFrom, 'effectiveFrom');
      if (vt > t) continue;
      if (vt > bestT || (vt === bestT && (best === undefined || v.version > best.version))) {
        best = v;
        bestT = vt;
      }
    }
    return best;
  }

  /**
   * Register an AI musician (a Kieku). Licensor shares — the training-data
   * artists its earnings flow to — must be valid exact-100% split sets over
   * registered holders, on at least one copyright side (ADR 0013).
   */
  registerAiMusician(musician: AiMusician): void {
    if (this.aiMusicians.has(musician.id)) {
      throw new RegistryError(`AI musician already registered: ${musician.id}`);
    }
    if (
      musician.compositionLicensorShares === undefined &&
      musician.masterLicensorShares === undefined
    ) {
      throw new RegistryError(
        `AI musician ${musician.id} must declare licensor shares on at least one side`,
      );
    }
    for (const shares of [musician.compositionLicensorShares, musician.masterLicensorShares]) {
      if (shares === undefined) continue;
      validateSplits(shares);
      for (const share of shares) {
        if (!this.holders.has(share.holderId)) {
          throw new RegistryError(
            `AI musician ${musician.id} references unregistered rights-holder: ${share.holderId}`,
          );
        }
      }
    }
    this.aiMusicians.set(musician.id, musician);
  }

  getAiMusician(id: AiMusicianId): AiMusician | undefined {
    return this.aiMusicians.get(id);
  }

  getWork(id: WorkId): Work | undefined {
    return this.works.get(id);
  }

  getRecording(id: RecordingId): Recording | undefined {
    return this.recordings.get(id);
  }

  getRightsHolder(id: RightsHolderId): RightsHolder | undefined {
    return this.holders.get(id);
  }

  getAsset(id: AssetId): Asset | undefined {
    return this.assets.get(id);
  }

  assetByExternalId(externalId: string): Asset | undefined {
    const id = this.assetsByExternalId.get(externalId);
    return id === undefined ? undefined : this.assets.get(id);
  }

  /** Effective composition shares carried by an asset (via its work), if any. */
  compositionSharesForAsset(assetId: AssetId, at: string): readonly SplitShare[] | undefined {
    const asset = this.assets.get(assetId);
    if (!asset || asset.workId === undefined) return undefined;
    return this.splitsAt('composition', { workId: asset.workId }, at)?.shares;
  }

  /** Effective master shares carried by an asset (via its recording), if any. */
  masterSharesForAsset(assetId: AssetId, at: string): readonly SplitShare[] | undefined {
    const asset = this.assets.get(assetId);
    if (!asset || asset.recordingId === undefined) return undefined;
    return this.splitsAt('master', { recordingId: asset.recordingId }, at)?.shares;
  }
}
