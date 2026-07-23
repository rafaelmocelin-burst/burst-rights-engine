import type {
  Asset,
  AssetId,
  Creation,
  CreationId,
  EventId,
  LedgerEntry,
  LedgerEntryId,
  License,
  LicenseId,
  ProvenanceEntry,
  RecordingId,
  RightsHolderId,
  RightType,
  SplitShare,
  UsageEvent,
  UserId,
  WorkId,
} from '@burst/domain';
import type { Sql } from 'postgres';
import type {
  AccrualToPersist,
  AppendUsageResult,
  CreationContext,
  ResolvedIngredient,
  RightsStore,
} from '../ports.js';

/**
 * Postgres adapter — the production store.
 *
 * Two things here are load-bearing and must not be "simplified" away:
 *  1. `appendUsageWithLedger` runs in ONE transaction with an
 *     `on conflict do nothing` on the event's idempotency key, so a replay or a
 *     concurrent duplicate can never accrue twice, and an event is never
 *     committed without its ledger entries.
 *  2. Split resolution is **as-of a timestamp** (`distinct on … order by
 *     effective_from desc, version desc`), matching InMemoryRegistry.splitsAt,
 *     so a historical event reproduces exactly.
 *
 * Money is read and written as `bigint` throughout; `postgres` returns int8 as
 * a string by default, which we parse with BigInt — never through Number.
 */
export class PostgresStore implements RightsStore {
  constructor(private readonly sql: Sql) {}

  async ping(): Promise<void> {
    await this.sql`select 1`;
  }

  async assetByExternalId(externalId: string): Promise<Asset | undefined> {
    const rows = await this.sql<
      { id: string; kind: string; name: string; work_id: string | null; recording_id: string | null }[]
    >`
      select id, kind, name, work_id, recording_id
      from rights.asset
      where external_id = ${externalId}
    `;
    const row = rows[0];
    if (!row) return undefined;
    const base = { id: row.id as AssetId, kind: row.kind as Asset['kind'], name: row.name };
    return {
      ...base,
      ...(row.work_id !== null ? { workId: row.work_id as WorkId } : {}),
      ...(row.recording_id !== null ? { recordingId: row.recording_id as RecordingId } : {}),
    };
  }

  async findCreationByEventId(eventId: EventId): Promise<Creation | undefined> {
    const rows = await this.sql<
      { id: string; event_id: string; user_id: string; created_at: Date }[]
    >`
      select id, event_id, user_id, created_at from rights.creation where event_id = ${eventId}
    `;
    return rows[0] ? this.hydrateCreation(rows[0]) : undefined;
  }

  async findCreationById(creationId: CreationId): Promise<Creation | undefined> {
    const rows = await this.sql<
      { id: string; event_id: string; user_id: string; created_at: Date }[]
    >`
      select id, event_id, user_id, created_at from rights.creation where id = ${creationId}
    `;
    return rows[0] ? this.hydrateCreation(rows[0]) : undefined;
  }

  private async hydrateCreation(row: {
    id: string;
    event_id: string;
    user_id: string;
    created_at: Date;
  }): Promise<Creation> {
    const entries = await this.sql<{ asset_id: string; usage: string }[]>`
      select asset_id, usage from rights.provenance_entry where creation_id = ${row.id}
      order by asset_id, usage
    `;
    return {
      id: row.id as CreationId,
      eventId: row.event_id as EventId,
      userId: row.user_id as UserId,
      createdAt: row.created_at.toISOString(),
      recipe: entries.map(
        (e): ProvenanceEntry => ({ assetId: e.asset_id as AssetId, usage: e.usage }),
      ),
    };
  }

  async insertCreation(
    creation: Creation,
    rawRecipe: unknown,
    externalId: string | undefined,
  ): Promise<{ creation: Creation; inserted: boolean }> {
    return this.sql.begin(async (tx) => {
      const inserted = await tx<{ id: string }[]>`
        insert into rights.creation (id, event_id, external_id, user_id, created_at, raw_recipe)
        values (
          ${creation.id}, ${creation.eventId}, ${externalId ?? null},
          ${creation.userId}, ${creation.createdAt}, ${tx.json(rawRecipe as never)}
        )
        on conflict (event_id) do nothing
        returning id
      `;
      if (inserted.length === 0) {
        // Lost the race (or a replay): return the row that won.
        const existing = await this.findCreationByEventId(creation.eventId);
        return { creation: existing ?? creation, inserted: false };
      }
      for (const entry of creation.recipe) {
        await tx`
          insert into rights.provenance_entry (creation_id, asset_id, usage)
          values (${creation.id}, ${entry.assetId}, ${entry.usage})
          on conflict do nothing
        `;
      }
      return { creation, inserted: true };
    }) as Promise<{ creation: Creation; inserted: boolean }>;
  }

  async loadCreationContext(
    creationId: CreationId,
    at: string,
  ): Promise<CreationContext | undefined> {
    const creation = await this.findCreationById(creationId);
    if (!creation) return undefined;

    const assetIds = [...new Set(creation.recipe.map((e) => e.assetId))];
    if (assetIds.length === 0) {
      return {
        creation,
        creatorHolderId: await this.rightsHolderForUser(creation.userId),
        ingredients: [],
      };
    }

    const [assets, compShares, masterShares, licenses] = await Promise.all([
      this.sql<{ id: string; work_id: string | null; recording_id: string | null }[]>`
        select id, work_id, recording_id from rights.asset where id in ${this.sql(assetIds)}
      `,
      this.effectiveShares('composition', assetIds, at),
      this.effectiveShares('master', assetIds, at),
      this.licensesForAssets(assetIds),
    ]);

    const assetById = new Map(assets.map((a) => [a.id, a]));
    const ingredients: ResolvedIngredient[] = creation.recipe.map((entry) => {
      const asset = assetById.get(entry.assetId);
      const comp = asset?.work_id ? compShares.get(asset.work_id) : undefined;
      const master = asset?.recording_id ? masterShares.get(asset.recording_id) : undefined;
      return {
        assetId: entry.assetId,
        usage: entry.usage,
        licenses: licenses.get(entry.assetId) ?? [],
        ...(comp ? { compositionShares: comp } : {}),
        ...(master ? { masterShares: master } : {}),
      };
    });

    return {
      creation,
      creatorHolderId: await this.rightsHolderForUser(creation.userId),
      ingredients,
    };
  }

  /**
   * Effective split shares per subject as of `at`. `distinct on` picks the
   * latest-effective version (ties → highest version number), exactly matching
   * the in-memory registry's resolution rule.
   */
  private async effectiveShares(
    rightType: RightType,
    assetIds: readonly string[],
    at: string,
  ): Promise<Map<string, SplitShare[]>> {
    const subjectColumn = rightType === 'composition' ? 'work_id' : 'recording_id';
    const rows = await this.sql<{ subject_id: string; holder_id: string; ppm: string }[]>`
      with subjects as (
        select distinct ${this.sql(subjectColumn)} as subject_id
        from rights.asset
        where id in ${this.sql(assetIds as string[])}
          and ${this.sql(subjectColumn)} is not null
      ),
      effective as (
        select distinct on (sv.${this.sql(subjectColumn)})
          sv.${this.sql(subjectColumn)} as subject_id, sv.id as split_version_id
        from rights.split_version sv
        join subjects s on s.subject_id = sv.${this.sql(subjectColumn)}
        where sv.right_type = ${rightType}
          and sv.effective_from <= ${at}
        order by sv.${this.sql(subjectColumn)}, sv.effective_from desc, sv.version desc
      )
      select e.subject_id, ss.holder_id, ss.ppm::text as ppm
      from effective e
      join rights.split_share ss on ss.split_version_id = e.split_version_id
      order by e.subject_id, ss.holder_id
    `;
    const bySubject = new Map<string, SplitShare[]>();
    for (const row of rows) {
      const list = bySubject.get(row.subject_id) ?? [];
      list.push({ holderId: row.holder_id as RightsHolderId, ppm: BigInt(row.ppm) });
      bySubject.set(row.subject_id, list);
    }
    return bySubject;
  }

  private async licensesForAssets(assetIds: readonly string[]): Promise<Map<string, License[]>> {
    const rows = await this.sql<
      {
        id: string;
        asset_id: string;
        territories: string[];
        allowed_uses: string[];
        revenue_share_ppm: string;
        valid_from: Date;
        valid_until: Date | null;
      }[]
    >`
      select id, asset_id, territories, allowed_uses, revenue_share_ppm::text, valid_from, valid_until
      from rights.license
      where asset_id in ${this.sql(assetIds as string[])}
      order by asset_id, valid_from
    `;
    const byAsset = new Map<string, License[]>();
    for (const row of rows) {
      const list = byAsset.get(row.asset_id) ?? [];
      list.push({
        id: row.id as LicenseId,
        assetId: row.asset_id as AssetId,
        territories: row.territories,
        allowedUses: row.allowed_uses as License['allowedUses'],
        revenueSharePpm: BigInt(row.revenue_share_ppm),
        validFrom: row.valid_from.toISOString(),
        ...(row.valid_until ? { validUntil: row.valid_until.toISOString() } : {}),
      });
      byAsset.set(row.asset_id, list);
    }
    return byAsset;
  }

  async findUsageEvent(eventId: EventId): Promise<UsageEvent | undefined> {
    const rows = await this.sql<
      {
        event_id: string;
        kind: string;
        creation_id: string;
        occurred_at: Date;
        gross_amount_minor: string | null;
        currency: string | null;
        territory: string | null;
      }[]
    >`
      select event_id, kind, creation_id, occurred_at,
             gross_amount_minor::text, currency, territory
      from rights.usage_event where event_id = ${eventId}
    `;
    const row = rows[0];
    if (!row) return undefined;
    return {
      eventId: row.event_id as EventId,
      kind: row.kind as UsageEvent['kind'],
      creationId: row.creation_id as CreationId,
      occurredAt: row.occurred_at.toISOString(),
      ...(row.gross_amount_minor !== null && row.currency !== null
        ? { grossAmount: { amount: BigInt(row.gross_amount_minor), currency: row.currency.trim() } }
        : {}),
      ...(row.territory ? { territory: row.territory.trim() } : {}),
    };
  }

  async appendUsageWithLedger(
    event: UsageEvent,
    accruals: readonly AccrualToPersist[],
    ruleVersion: string,
  ): Promise<AppendUsageResult> {
    return this.sql.begin(async (tx) => {
      const inserted = await tx<{ id: string }[]>`
        insert into rights.usage_event
          (event_id, kind, creation_id, occurred_at, gross_amount_minor, currency, territory)
        values (
          ${event.eventId}, ${event.kind}, ${event.creationId}, ${event.occurredAt},
          ${event.grossAmount ? event.grossAmount.amount.toString() : null},
          ${event.grossAmount ? event.grossAmount.currency : null},
          ${event.territory ?? null}
        )
        on conflict (event_id) do nothing
        returning id
      `;

      if (inserted.length === 0) {
        // A concurrent request already accrued this event — return its entries,
        // accrue nothing. This is the last line of defence against double-counting.
        const existing = await tx<
          {
            id: string;
            holder_id: string;
            right_type: string;
            amount_minor: string;
            currency: string;
            rule_version: string;
            created_at: Date;
          }[]
        >`
          select le.id, le.holder_id, le.right_type, le.amount_minor::text,
                 le.currency, le.rule_version, le.created_at
          from rights.ledger_entry le
          join rights.usage_event ue on ue.id = le.usage_event_id
          where ue.event_id = ${event.eventId}
          order by le.right_type, le.holder_id
        `;
        return {
          inserted: false,
          entries: existing.map((r) => this.hydrateLedgerEntry(r, event.eventId)),
        };
      }

      const usageEventId = inserted[0]!.id;
      const entries: LedgerEntry[] = [];
      for (const accrual of accruals) {
        const rows = await tx<{ id: string; created_at: Date }[]>`
          insert into rights.ledger_entry
            (usage_event_id, holder_id, right_type, amount_minor, currency, rule_version)
          values (
            ${usageEventId}, ${accrual.holderId}, ${accrual.rightType},
            ${accrual.amount.amount.toString()}, ${accrual.amount.currency}, ${ruleVersion}
          )
          returning id, created_at
        `;
        entries.push({
          id: rows[0]!.id as LedgerEntryId,
          eventId: event.eventId,
          holderId: accrual.holderId,
          rightType: accrual.rightType,
          amount: accrual.amount,
          ruleVersion,
          createdAt: rows[0]!.created_at.toISOString(),
        });
      }
      return { inserted: true, entries };
    }) as Promise<AppendUsageResult>;
  }

  private hydrateLedgerEntry(
    row: {
      id: string;
      holder_id: string;
      right_type: string;
      amount_minor: string;
      currency: string;
      rule_version: string;
      created_at: Date;
    },
    eventId: EventId,
  ): LedgerEntry {
    return {
      id: row.id as LedgerEntryId,
      eventId,
      holderId: row.holder_id as RightsHolderId,
      rightType: row.right_type as RightType,
      amount: { amount: BigInt(row.amount_minor), currency: row.currency.trim() },
      ruleVersion: row.rule_version,
      createdAt: row.created_at.toISOString(),
    };
  }

  async ledgerEntriesForHolder(
    holderId: RightsHolderId,
    from: string,
    until: string,
  ): Promise<readonly LedgerEntry[]> {
    const rows = await this.sql<
      {
        id: string;
        event_id: string;
        holder_id: string;
        right_type: string;
        amount_minor: string;
        currency: string;
        rule_version: string;
        created_at: Date;
      }[]
    >`
      select le.id, ue.event_id, le.holder_id, le.right_type, le.amount_minor::text,
             le.currency, le.rule_version, le.created_at
      from rights.ledger_entry le
      join rights.usage_event ue on ue.id = le.usage_event_id
      where le.holder_id = ${holderId}
        and le.created_at >= ${from}
        and le.created_at < ${until}
      order by le.created_at, le.id
    `;
    return rows.map((r) => this.hydrateLedgerEntry(r, r.event_id as EventId));
  }

  async rightsHolderForUser(userId: UserId): Promise<RightsHolderId> {
    const existing = await this.sql<{ id: string }[]>`
      select id from rights.rights_holder where user_id = ${userId} and kind = 'user'
    `;
    if (existing[0]) return existing[0].id as RightsHolderId;

    // Concurrent first-usage by the same user is possible; the unique index in
    // migration 0003 makes the upsert idempotent rather than creating twins.
    const created = await this.sql<{ id: string }[]>`
      insert into rights.rights_holder (kind, name, user_id)
      values ('user', ${'User ' + userId}, ${userId})
      on conflict (user_id) where kind = 'user' do update set name = rights.rights_holder.name
      returning id
    `;
    return created[0]!.id as RightsHolderId;
  }
}
