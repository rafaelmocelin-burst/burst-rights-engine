import type {
  AssetId,
  CreationId,
  EventId,
  LedgerEntryId,
  LicenseId,
  RecordingId,
  RightsHolderId,
  SplitVersionId,
  UserId,
  WorkId,
} from './ids.js';
import type { Money } from './money.js';
import type { SplitShare } from './splits.js';

/**
 * Core domain entities (charter §5). Every piece of music carries TWO copyrights:
 * the composition (Work) and the recording (master / Recording). Ownership of each
 * is fractional and versioned. These types are pure data — no I/O, no framework.
 */

/** The composition copyright: the song as written (writers / publishers side). */
export interface Work {
  readonly id: WorkId;
  readonly title: string;
  /** ISWC if known (International Standard Musical Work Code). */
  readonly iswc?: string;
}

/** The master copyright: a specific recording of a Work (artist / label side). */
export interface Recording {
  readonly id: RecordingId;
  readonly workId: WorkId;
  readonly title: string;
  /** ISRC if known (International Standard Recording Code). */
  readonly isrc?: string;
}

export type AssetKind = 'sample' | 'loop' | 'stem' | 'tool_output' | 'ai_output';

/**
 * A usable piece of music content in the game (sample, loop, stem, producer-tool
 * output, AI output). Links to the Work and/or Recording whose rights it carries.
 */
export interface Asset {
  readonly id: AssetId;
  readonly kind: AssetKind;
  readonly name: string;
  readonly workId?: WorkId;
  readonly recordingId?: RecordingId;
}

export type RightsHolderKind =
  | 'writer'
  | 'publisher'
  | 'artist'
  | 'label'
  | 'user'
  | 'platform'
  | 'collection_society';

export interface RightsHolder {
  readonly id: RightsHolderId;
  readonly kind: RightsHolderKind;
  readonly name: string;
}

export type RightType = 'composition' | 'master';

/**
 * A versioned set of ownership shares for one right (composition or master) of one
 * subject (Work or Recording). Split versions are append-only: a change in ownership
 * creates a NEW version; old versions are kept so historical royalty runs reproduce.
 */
export interface SplitVersion {
  readonly id: SplitVersionId;
  readonly rightType: RightType;
  readonly workId?: WorkId; // exactly one of workId | recordingId is set
  readonly recordingId?: RecordingId;
  readonly version: number;
  readonly effectiveFrom: string; // ISO 8601 instant
  readonly shares: readonly SplitShare[];
}

export type LicenseUse = 'in_game_creation' | 'streaming' | 'purchase' | 'gift' | 'promotional';

/** Terms under which an Asset may be used. Checked/flagged by the licensing rules (Phase 5). */
export interface License {
  readonly id: LicenseId;
  readonly assetId: AssetId;
  /** ISO 3166-1 alpha-2 codes; empty array = worldwide. */
  readonly territories: readonly string[];
  readonly allowedUses: readonly LicenseUse[];
  /** Platform revenue share owed to the licensor, in ppm of attributable revenue. */
  readonly revenueSharePpm: bigint;
  readonly validFrom: string;
  readonly validUntil?: string;
}

/**
 * An AI musician (a Kieku): a specific model version whose training data was
 * licensed from identifiable artists. Its licensor shares are exact-100% split
 * sets over registered rights-holders — the people its earnings flow to when a
 * creation is made with it (ADR 0012). Model version is part of identity:
 * a retrained model is a NEW AiMusician, because its lineage may differ.
 */
export interface AiMusician {
  readonly id: import('./ids.js').AiMusicianId;
  readonly name: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly compositionLicensorShares?: readonly SplitShare[];
  readonly masterLicensorShares?: readonly SplitShare[];
}

/** One ingredient of a creation's recipe, as reported by the UE5 client. */
export interface ProvenanceEntry {
  readonly assetId: AssetId;
  /** How the asset was used, e.g. 'sampled' | 'looped' | 'stem' | 'preset'. Free-form for now; tightened in Phase 2. */
  readonly usage: string;
}

/** A user-made track and its full provenance recipe. */
export interface Creation {
  readonly id: CreationId;
  readonly eventId: EventId; // idempotency key of the provenance event that created it
  readonly userId: UserId;
  readonly createdAt: string;
  readonly recipe: readonly ProvenanceEntry[];
}

export type UsageKind = 'play' | 'stream' | 'purchase' | 'gift';

/** A monetizable (or countable) use of a Creation, emitted by the client or storefront. */
export interface UsageEvent {
  readonly eventId: EventId; // unique — reprocessing must never double-count
  readonly kind: UsageKind;
  readonly creationId: CreationId;
  readonly occurredAt: string;
  /** Gross revenue attributable to this event, if monetary (purchase price, stream payout, …). */
  readonly grossAmount?: Money;
  /** ISO 3166-1 alpha-2 country of the use, for license/territory checks. */
  readonly territory?: string;
}

/**
 * One immutable accrual: "holder H is owed amount A because of event E, computed by
 * rule version R". The ledger is append-only; corrections are new negating entries.
 */
export interface LedgerEntry {
  readonly id: LedgerEntryId;
  readonly eventId: EventId;
  readonly holderId: RightsHolderId;
  readonly rightType: RightType;
  readonly amount: Money;
  readonly ruleVersion: string;
  readonly createdAt: string;
}
