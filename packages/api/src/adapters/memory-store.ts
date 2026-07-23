import {
  InMemoryRegistry,
  type Asset,
  type Creation,
  type CreationId,
  type EventId,
  type LedgerEntry,
  type LedgerEntryId,
  type License,
  type RightsHolderId,
  type UsageEvent,
  type UserId,
} from '@burst/domain';
import type {
  AccrualToPersist,
  AppendUsageResult,
  CreationContext,
  RightsStore,
} from '../ports.js';

/**
 * In-memory store for tests and local development. It mirrors the Postgres
 * adapter's *semantics* — idempotency, append-only, transactional all-or-nothing
 * accrual — so the API test suite is a genuine contract both adapters must meet.
 */
export class InMemoryStore implements RightsStore {
  readonly registry = new InMemoryRegistry();
  private readonly creations = new Map<string, Creation>();
  private readonly rawRecipes = new Map<string, unknown>();
  private readonly usageEvents = new Map<string, UsageEvent>();
  private readonly ledger: LedgerEntry[] = [];
  private readonly holderByUser = new Map<string, RightsHolderId>();
  private readonly licensesByAsset = new Map<string, License[]>();
  private ledgerSeq = 0;

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  addLicense(license: License): void {
    const list = this.licensesByAsset.get(license.assetId) ?? [];
    list.push(license);
    this.licensesByAsset.set(license.assetId, list);
  }

  linkUserToHolder(userId: UserId, holderId: RightsHolderId): void {
    this.holderByUser.set(userId, holderId);
  }

  async assetByExternalId(externalId: string): Promise<Asset | undefined> {
    return this.registry.assetByExternalId(externalId);
  }

  async findCreationByEventId(eventId: EventId): Promise<Creation | undefined> {
    return [...this.creations.values()].find((c) => c.eventId === eventId);
  }

  async findCreationById(creationId: CreationId): Promise<Creation | undefined> {
    return this.creations.get(creationId);
  }

  async insertCreation(
    creation: Creation,
    rawRecipe: unknown,
  ): Promise<{ creation: Creation; inserted: boolean }> {
    const existing = await this.findCreationByEventId(creation.eventId);
    if (existing) return { creation: existing, inserted: false };
    this.creations.set(creation.id, creation);
    this.rawRecipes.set(creation.id, rawRecipe);
    return { creation, inserted: true };
  }

  async loadCreationContext(
    creationId: CreationId,
    at: string,
  ): Promise<CreationContext | undefined> {
    const creation = this.creations.get(creationId);
    if (!creation) return undefined;
    return {
      creation,
      creatorHolderId: await this.rightsHolderForUser(creation.userId),
      ingredients: creation.recipe.map((entry) => {
        const comp = this.registry.compositionSharesForAsset(entry.assetId, at);
        const master = this.registry.masterSharesForAsset(entry.assetId, at);
        return {
          assetId: entry.assetId,
          usage: entry.usage,
          licenses: this.licensesByAsset.get(entry.assetId) ?? [],
          ...(comp ? { compositionShares: comp } : {}),
          ...(master ? { masterShares: master } : {}),
        };
      }),
    };
  }

  async findUsageEvent(eventId: EventId): Promise<UsageEvent | undefined> {
    return this.usageEvents.get(eventId);
  }

  async appendUsageWithLedger(
    event: UsageEvent,
    accruals: readonly AccrualToPersist[],
    ruleVersion: string,
  ): Promise<AppendUsageResult> {
    if (this.usageEvents.has(event.eventId)) {
      return {
        inserted: false,
        entries: this.ledger.filter((e) => e.eventId === event.eventId),
      };
    }
    const createdAt = this.now();
    const entries = accruals.map((a): LedgerEntry => {
      this.ledgerSeq += 1;
      return {
        id: `ledger-${this.ledgerSeq}` as LedgerEntryId,
        eventId: event.eventId,
        holderId: a.holderId,
        rightType: a.rightType,
        amount: a.amount,
        ruleVersion,
        createdAt,
      };
    });
    // Commit both together — never the event without its accruals.
    this.usageEvents.set(event.eventId, event);
    this.ledger.push(...entries);
    return { inserted: true, entries };
  }

  async ledgerEntriesForHolder(
    holderId: RightsHolderId,
    from: string,
    until: string,
  ): Promise<readonly LedgerEntry[]> {
    const fromT = Date.parse(from);
    const untilT = Date.parse(until);
    return this.ledger.filter((e) => {
      if (e.holderId !== holderId) return false;
      const t = Date.parse(e.createdAt);
      return t >= fromT && t < untilT;
    });
  }

  async rightsHolderForUser(userId: UserId): Promise<RightsHolderId> {
    const existing = this.holderByUser.get(userId);
    if (existing) return existing;
    const holderId = `holder-user-${userId}` as RightsHolderId;
    this.registry.registerRightsHolder({ id: holderId, kind: 'user', name: `User ${userId}` });
    this.holderByUser.set(userId, holderId);
    return holderId;
  }

  async ping(): Promise<void> {
    // Always healthy.
  }
}
