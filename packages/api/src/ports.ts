import type {
  Asset,
  Creation,
  License,
  LedgerEntry,
  Money,
  RightsHolderId,
  SplitShare,
  UsageEvent,
  UserId,
} from '@burst/domain';
import type { CreationId, EventId } from '@burst/domain';

/**
 * Storage ports. The handlers depend on these interfaces only — never on
 * Postgres, Supabase, or HTTP — so the whole API is testable against the
 * in-memory adapter, and the Postgres adapter is swappable.
 *
 * Everything money-touching is expressed as a **single transactional
 * operation** (`appendUsageWithLedger`) rather than a sequence of writes the
 * caller could interleave or partially apply.
 */

/** A recipe ingredient with the rights it carried at a given instant. */
export interface ResolvedIngredient {
  readonly assetId: Asset['id'];
  readonly usage: string;
  readonly compositionShares?: readonly SplitShare[];
  readonly masterShares?: readonly SplitShare[];
  readonly licenses: readonly License[];
}

export interface CreationContext {
  readonly creation: Creation;
  readonly ingredients: readonly ResolvedIngredient[];
  /** Rights-holder representing the creating user; created on demand at ingest. */
  readonly creatorHolderId: RightsHolderId;
}

export interface AccrualToPersist {
  readonly holderId: RightsHolderId;
  readonly rightType: 'composition' | 'master';
  readonly amount: Money;
}

export interface AppendUsageResult {
  /** False when the event_id was already present — the replay was a no-op. */
  readonly inserted: boolean;
  readonly entries: readonly LedgerEntry[];
}

export interface RightsStore {
  /** Resolves the game's external asset id (e.g. 'S_…') to a registry asset. */
  assetByExternalId(externalId: string): Promise<Asset | undefined>;

  findCreationByEventId(eventId: EventId): Promise<Creation | undefined>;
  findCreationById(creationId: CreationId): Promise<Creation | undefined>;

  /**
   * Persist a creation and its normalized recipe. Idempotent on
   * `creation.eventId`: a replay returns the existing row and writes nothing.
   */
  insertCreation(
    creation: Creation,
    rawRecipe: unknown,
    externalId: string | undefined,
  ): Promise<{ creation: Creation; inserted: boolean }>;

  /**
   * Everything needed to attribute and price a usage of this creation, with
   * ownership resolved as of `at` — so a historical event reproduces exactly.
   */
  loadCreationContext(creationId: CreationId, at: string): Promise<CreationContext | undefined>;

  findUsageEvent(eventId: EventId): Promise<UsageEvent | undefined>;

  /**
   * Append a usage event and its ledger entries **in one transaction**. If the
   * event_id already exists (concurrent duplicate), inserts nothing and returns
   * the existing entries — this is the last line of defence against
   * double-counting when two requests race past the pre-check.
   */
  appendUsageWithLedger(
    event: UsageEvent,
    accruals: readonly AccrualToPersist[],
    ruleVersion: string,
  ): Promise<AppendUsageResult>;

  /** Ledger entries for a holder within [from, until), for statement building. */
  ledgerEntriesForHolder(
    holderId: RightsHolderId,
    from: string,
    until: string,
  ): Promise<readonly LedgerEntry[]>;

  /** Maps a game user id onto its rights-holder row, creating one if absent. */
  rightsHolderForUser(userId: UserId): Promise<RightsHolderId>;

  /** Liveness probe for /v1/health. */
  ping(): Promise<void>;
}
