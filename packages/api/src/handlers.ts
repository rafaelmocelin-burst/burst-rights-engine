import {
  ATTRIBUTION_V1,
  attributeV1,
  buildHolderStatement,
  checkLicenses,
  computeRoyaltyV1,
  DEFAULT_ATTRIBUTION_POLICY_V1,
  DEFAULT_ROYALTY_POLICY_V1,
  extractAssetRefsFromSnapshot,
  ingestProvenance,
  money,
  ROYALTY_V1,
  type Asset,
  type AttributionPolicyV1,
  type CreationId,
  type EventId,
  type RightsHolderId,
  type RoyaltyPolicyV1,
  type UsageEvent,
} from '@burst/domain';
import type { Principal } from './auth.js';
import { badRequest, forbidden, notFound } from './errors.js';
import { moneyToJson, parseMinorUnits } from './json.js';
import type { RightsStore } from './ports.js';
import {
  parseOrThrow,
  provenanceEventSchema,
  statementQuerySchema,
  usageEventSchema,
} from './validation.js';

export interface HandlerDeps {
  readonly store: RightsStore;
  readonly newId: () => string;
  readonly attributionPolicy?: AttributionPolicyV1;
  readonly royaltyPolicy?: RoyaltyPolicyV1;
}

export interface HandlerResult {
  readonly status: number;
  readonly body: unknown;
}

// --- provenance ingest -------------------------------------------------------

/**
 * `POST /v1/events/provenance` — record a creation and its recipe.
 * Idempotent on `eventId`: a replay returns 200 with the existing creation,
 * a first sighting returns 201.
 */
export async function postProvenanceEvent(
  body: unknown,
  principal: Principal,
  deps: HandlerDeps,
): Promise<HandlerResult> {
  const input = parseOrThrow(provenanceEventSchema, body, 'provenance event');

  const existing = await deps.store.findCreationByEventId(input.eventId as EventId);
  if (existing) {
    return {
      status: 200,
      body: { creationId: existing.id, duplicate: true, unresolvedAssets: [] },
    };
  }

  // Resolve every external id the ingester could possibly ask about — the
  // canonical entries when present, otherwise whatever the snapshot yields —
  // BEFORE calling it, so the pure function gets a complete synchronous
  // resolver and its result needs no patching afterwards.
  const externalIds =
    input.entries !== undefined
      ? input.entries.map((e) => e.assetExternalId)
      : extractAssetRefsFromSnapshot(input.recipe);
  const resolved = new Map<string, Asset | undefined>();
  for (const ext of new Set(externalIds)) {
    resolved.set(ext, await deps.store.assetByExternalId(ext));
  }

  const outcome = ingestProvenance(
    {
      eventId: input.eventId as EventId,
      userId: principal.userId,
      occurredAt: input.occurredAt,
      recipe: input.recipe,
      ...(input.externalCreationId !== undefined
        ? { externalCreationId: input.externalCreationId }
        : {}),
      ...(input.entries !== undefined ? { entries: input.entries } : {}),
    },
    {
      findCreationByEventId: () => undefined, // already checked against the store above
      assetByExternalId: (ext) => resolved.get(ext),
    },
    deps.newId() as CreationId,
  );

  if (outcome.kind === 'duplicate') {
    return { status: 200, body: { creationId: outcome.existing.id, duplicate: true, unresolvedAssets: [] } };
  }

  const saved = await deps.store.insertCreation(
    outcome.creation,
    input.recipe,
    input.externalCreationId,
  );

  return {
    status: saved.inserted ? 201 : 200,
    body: {
      creationId: saved.creation.id,
      duplicate: !saved.inserted,
      // Surfaced, never silently dropped: an unregistered sample is a rights problem.
      unresolvedAssets: outcome.unresolved,
    },
  };
}

// --- usage ingest (the money path) ------------------------------------------

/**
 * `POST /v1/events/usage` — record a usage and accrue royalties.
 *
 * Idempotency is defended twice: a pre-check here, and a unique constraint
 * inside the single transaction that appends the event and its ledger entries.
 * Two concurrent identical events therefore accrue exactly once.
 */
export async function postUsageEvent(
  body: unknown,
  principal: Principal,
  deps: HandlerDeps,
): Promise<HandlerResult> {
  const input = parseOrThrow(usageEventSchema, body, 'usage event');

  const already = await deps.store.findUsageEvent(input.eventId as EventId);
  if (already) {
    return { status: 200, body: { eventId: input.eventId, duplicate: true, accruals: [] } };
  }

  const context = await deps.store.loadCreationContext(
    input.creationId as CreationId,
    input.occurredAt,
  );
  if (!context) throw notFound('creation_not_found', `No creation ${input.creationId}`);

  // Only the creator or a trusted service may report usage of a creation.
  if (!principal.isService && context.creation.userId !== principal.userId) {
    throw forbidden('Not permitted to report usage for this creation');
  }

  const licenseCheck = checkLicenses({
    usageKind: input.kind,
    occurredAt: input.occurredAt,
    ...(input.territory !== undefined ? { territory: input.territory } : {}),
    assets: context.ingredients.map((i) => ({ assetId: i.assetId, licenses: i.licenses })),
  });

  const attribution = attributeV1({
    creatorHolderId: context.creatorHolderId,
    ingredients: dedupeIngredients(context),
    policy: deps.attributionPolicy ?? DEFAULT_ATTRIBUTION_POLICY_V1,
  });

  // Non-monetary usage is recorded for audit and licence checking, but accrues
  // nothing — royalty/v1 prices money events only (ADR 0008).
  if (input.grossAmountMinor === undefined) {
    const event: UsageEvent = {
      eventId: input.eventId as EventId,
      kind: input.kind,
      creationId: input.creationId as CreationId,
      occurredAt: input.occurredAt,
      ...(input.territory !== undefined ? { territory: input.territory } : {}),
    };
    const result = await deps.store.appendUsageWithLedger(event, [], ROYALTY_V1);
    return {
      status: result.inserted ? 201 : 200,
      body: {
        eventId: input.eventId,
        duplicate: !result.inserted,
        accruals: [],
        licensePermitted: licenseCheck.permitted,
        licenseViolations: licenseCheck.violations,
      },
    };
  }

  const gross = money(
    parseMinorUnits(input.grossAmountMinor, 'grossAmountMinor'),
    input.currency!,
  );
  const event: UsageEvent = {
    eventId: input.eventId as EventId,
    kind: input.kind,
    creationId: input.creationId as CreationId,
    occurredAt: input.occurredAt,
    grossAmount: gross,
    ...(input.territory !== undefined ? { territory: input.territory } : {}),
  };

  const royalty = computeRoyaltyV1({
    event,
    composition: attribution.composition,
    master: attribution.master,
    policy: deps.royaltyPolicy ?? DEFAULT_ROYALTY_POLICY_V1,
  });

  const result = await deps.store.appendUsageWithLedger(
    event,
    royalty.entries.map((e) => ({
      holderId: e.holderId,
      rightType: e.rightType,
      amount: e.amount,
    })),
    ROYALTY_V1,
  );

  return {
    status: result.inserted ? 201 : 200,
    body: {
      eventId: input.eventId,
      duplicate: !result.inserted,
      platformFee: moneyToJson(royalty.platformFee),
      ruleVersions: { attribution: ATTRIBUTION_V1, royalty: ROYALTY_V1 },
      accruals: result.entries.map((e) => ({
        holderId: e.holderId,
        rightType: e.rightType,
        amount: moneyToJson(e.amount),
      })),
      licensePermitted: licenseCheck.permitted,
      licenseViolations: licenseCheck.violations,
    },
  };
}

/**
 * A recipe can list the same asset under several usages; attribution counts
 * distinct assets, so collapse them before attributing.
 */
function dedupeIngredients(context: {
  ingredients: readonly {
    assetId: string;
    compositionShares?: readonly unknown[];
    masterShares?: readonly unknown[];
  }[];
}): Parameters<typeof attributeV1>[0]['ingredients'] {
  const seen = new Map<string, (typeof context.ingredients)[number]>();
  for (const i of context.ingredients) if (!seen.has(i.assetId)) seen.set(i.assetId, i);
  return [...seen.values()].map((i) => ({
    assetId: i.assetId as never,
    ...(i.compositionShares !== undefined ? { compositionShares: i.compositionShares as never } : {}),
    ...(i.masterShares !== undefined ? { masterShares: i.masterShares as never } : {}),
  }));
}

// --- queries -----------------------------------------------------------------

/** `GET /v1/creations/:id/splits` — the attributed ownership of a creation. */
export async function getCreationSplits(
  creationId: string,
  at: string | undefined,
  deps: HandlerDeps,
): Promise<HandlerResult> {
  const context = await deps.store.loadCreationContext(
    creationId as CreationId,
    at ?? new Date().toISOString(),
  );
  if (!context) throw notFound('creation_not_found', `No creation ${creationId}`);

  const attribution = attributeV1({
    creatorHolderId: context.creatorHolderId,
    ingredients: dedupeIngredients(context),
    policy: deps.attributionPolicy ?? DEFAULT_ATTRIBUTION_POLICY_V1,
  });

  const render = (shares: readonly { holderId: string; ppm: bigint }[]) =>
    shares.map((s) => ({ holderId: s.holderId, ppm: Number(s.ppm), percent: Number(s.ppm) / 10_000 }));

  return {
    status: 200,
    body: {
      creationId,
      ruleVersion: ATTRIBUTION_V1,
      composition: render(attribution.composition),
      master: render(attribution.master),
    },
  };
}

/** `GET /v1/holders/:id/statement?from=&until=&currency=` */
export async function getHolderStatement(
  holderId: string,
  query: Record<string, string | undefined>,
  principal: Principal,
  deps: HandlerDeps,
): Promise<HandlerResult> {
  const parsed = parseOrThrow(statementQuerySchema, query, 'statement query');

  // A holder may read only their own statement; services may read any.
  if (!principal.isService) {
    const own = await deps.store.rightsHolderForUser(principal.userId);
    if (own !== holderId) throw forbidden('Not permitted to read this statement');
  }

  if (Date.parse(parsed.until) <= Date.parse(parsed.from)) {
    throw badRequest('invalid_period', 'until must be after from');
  }

  const entries = await deps.store.ledgerEntriesForHolder(
    holderId as RightsHolderId,
    parsed.from,
    parsed.until,
  );
  const statement = buildHolderStatement(
    holderId as RightsHolderId,
    entries,
    { from: parsed.from, until: parsed.until },
    parsed.currency,
  );

  return {
    status: 200,
    body: {
      holderId: statement.holderId,
      period: statement.period,
      currency: statement.currency,
      lines: statement.lines.map((l) => ({
        rightType: l.rightType,
        amount: moneyToJson(l.amount),
        entryCount: l.entryCount,
      })),
      total: moneyToJson(statement.total),
      ruleVersions: statement.ruleVersions,
    },
  };
}

export async function getHealth(deps: HandlerDeps): Promise<HandlerResult> {
  await deps.store.ping();
  return { status: 200, body: { status: 'ok', api: 'v1' } };
}
