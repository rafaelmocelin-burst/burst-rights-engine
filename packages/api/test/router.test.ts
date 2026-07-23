import { describe, expect, it } from 'vitest';
import { handleRequest, type ApiRequest, type RouterDeps } from '../src/router.js';
import { makeDeps, seedLicensedStem } from './helpers.js';

function req(overrides: Partial<ApiRequest> & Pick<ApiRequest, 'method' | 'path'>): ApiRequest {
  return { query: {}, headers: {}, ...overrides };
}

const asUser = (id = 'maya') => ({ authorization: `Bearer user:${id}` });
const asService = { authorization: 'Bearer service:storefront' };

async function ingestCreation(deps: RouterDeps, externalAssetId: string, eventId = 'evt-prov-1') {
  const res = await handleRequest(
    req({
      method: 'POST',
      path: '/v1/events/provenance',
      headers: asUser(),
      body: {
        eventId,
        externalCreationId: 'ST_mayatrack001',
        occurredAt: '2026-07-01T10:00:00Z',
        recipe: { Tracks: [{ Clips: [{ SampleID: externalAssetId }] }] },
        entries: [{ assetExternalId: externalAssetId, usage: 'sampled' }],
      },
    }),
    deps,
  );
  return res;
}

describe('routing and auth', () => {
  it('serves health without authentication', async () => {
    const res = await handleRequest(req({ method: 'GET', path: '/v1/health' }), makeDeps());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', api: 'v1' });
  });

  it('tolerates a trailing slash', async () => {
    const res = await handleRequest(req({ method: 'GET', path: '/v1/health/' }), makeDeps());
    expect(res.status).toBe(200);
  });

  it('404s unknown routes and unversioned paths', async () => {
    const deps = makeDeps();
    for (const path of ['/v1/nope', '/health', '/v2/health']) {
      const res = await handleRequest(req({ method: 'GET', path }), deps);
      expect(res.status).toBe(404);
    }
  });

  it('rejects missing, malformed, and unverifiable credentials', async () => {
    const deps = makeDeps();
    const base = { method: 'POST' as const, path: '/v1/events/provenance', body: {} };

    expect((await handleRequest(req(base), deps)).status).toBe(401);
    expect(
      (await handleRequest(req({ ...base, headers: { authorization: 'user:maya' } }), deps)).status,
    ).toBe(401);
    expect(
      (await handleRequest(req({ ...base, headers: { authorization: 'Bearer nonsense' } }), deps))
        .status,
    ).toBe(401);
  });

  it('does not leak internals in the 401 body', async () => {
    const deps = makeDeps();
    const res = await handleRequest(
      req({ method: 'POST', path: '/v1/events/usage', headers: { authorization: 'Bearer bad' } }),
      deps,
    );
    expect(res.body).toEqual({
      error: { code: 'unauthorized', message: 'Token verification failed' },
    });
  });
});

describe('POST /v1/events/provenance', () => {
  it('creates a creation and resolves its ingredients', async () => {
    const deps = makeDeps();
    const seed = seedLicensedStem(deps.store);
    const res = await ingestCreation(deps, seed.assetExternalId);

    expect(res.status).toBe(201);
    const body = res.body as { creationId: string; duplicate: boolean; unresolvedAssets: string[] };
    expect(body.duplicate).toBe(false);
    expect(body.unresolvedAssets).toEqual([]);
    expect(await deps.store.findCreationById(body.creationId as never)).toBeDefined();
  });

  it('is idempotent: replaying the event returns 200 and creates nothing new', async () => {
    const deps = makeDeps();
    const seed = seedLicensedStem(deps.store);
    const first = (await ingestCreation(deps, seed.assetExternalId)).body as { creationId: string };
    const replay = await ingestCreation(deps, seed.assetExternalId);

    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ creationId: first.creationId, duplicate: true });
  });

  it('reports unregistered samples instead of silently dropping them', async () => {
    const deps = makeDeps();
    seedLicensedStem(deps.store);
    const res = await handleRequest(
      req({
        method: 'POST',
        path: '/v1/events/provenance',
        headers: asUser(),
        body: {
          eventId: 'evt-prov-unknown',
          occurredAt: '2026-07-01T10:00:00Z',
          recipe: {},
          entries: [{ assetExternalId: 'S_notregistered00', usage: 'sampled' }],
        },
      }),
      deps,
    );
    expect(res.status).toBe(201);
    expect((res.body as { unresolvedAssets: string[] }).unresolvedAssets).toEqual([
      'S_notregistered00',
    ]);
  });

  it('rejects malformed bodies with field-level detail', async () => {
    const deps = makeDeps();
    const res = await handleRequest(
      req({
        method: 'POST',
        path: '/v1/events/provenance',
        headers: asUser(),
        body: { eventId: 'short', occurredAt: 'not-a-date', recipe: {} },
      }),
      deps,
    );
    expect(res.status).toBe(400);
    const body = res.body as { error: { code: string; details: { path: string }[] } };
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details.map((d) => d.path).sort()).toEqual(['eventId', 'occurredAt']);
  });
});

describe('POST /v1/events/usage — the money path', () => {
  async function setup() {
    const deps = makeDeps();
    const seed = seedLicensedStem(deps.store);
    const creation = (await ingestCreation(deps, seed.assetExternalId)).body as {
      creationId: string;
    };
    return { deps, seed, creationId: creation.creationId };
  }

  it('accrues royalties that conserve the gross exactly', async () => {
    const { deps, creationId } = await setup();
    const res = await handleRequest(
      req({
        method: 'POST',
        path: '/v1/events/usage',
        headers: asUser(),
        body: {
          eventId: 'evt-buy-1',
          kind: 'purchase',
          creationId,
          occurredAt: '2026-07-15T20:00:00Z',
          grossAmountMinor: '999',
          currency: 'EUR',
          territory: 'FI',
        },
      }),
      deps,
    );

    expect(res.status).toBe(201);
    const body = res.body as {
      platformFee: { amountMinor: string };
      accruals: { holderId: string; amount: { amountMinor: string } }[];
      licensePermitted: boolean;
      ruleVersions: { attribution: string; royalty: string };
    };

    // 60% fee of 999 = 599; the remaining 400 splits across holders.
    expect(body.platformFee.amountMinor).toBe('599');
    const accrued = body.accruals.reduce((acc, a) => acc + BigInt(a.amount.amountMinor), 0n);
    expect(BigInt(body.platformFee.amountMinor) + accrued).toBe(999n);
    expect(body.licensePermitted).toBe(true);
    expect(body.ruleVersions).toEqual({ attribution: 'attribution/v1', royalty: 'royalty/v1' });
  });

  it('never double-counts a replayed event', async () => {
    const { deps, creationId } = await setup();
    const body = {
      eventId: 'evt-buy-dupe',
      kind: 'purchase',
      creationId,
      occurredAt: '2026-07-15T20:00:00Z',
      grossAmountMinor: '1000',
      currency: 'EUR',
    };
    const first = await handleRequest(
      req({ method: 'POST', path: '/v1/events/usage', headers: asUser(), body }),
      deps,
    );
    const replay = await handleRequest(
      req({ method: 'POST', path: '/v1/events/usage', headers: asUser(), body }),
      deps,
    );

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect((replay.body as { duplicate: boolean }).duplicate).toBe(true);

    // The ledger holds exactly one round of accruals.
    const entries = await deps.store.ledgerEntriesForHolder(
      'holder-label' as never,
      '2026-07-01T00:00:00Z',
      '2026-08-01T00:00:00Z',
    );
    expect(entries).toHaveLength(1);
  });

  it('records a non-monetary play without accruing anything', async () => {
    const { deps, creationId } = await setup();
    const res = await handleRequest(
      req({
        method: 'POST',
        path: '/v1/events/usage',
        headers: asUser(),
        body: {
          eventId: 'evt-play-1',
          kind: 'play',
          creationId,
          occurredAt: '2026-07-15T20:00:00Z',
        },
      }),
      deps,
    );
    expect(res.status).toBe(201);
    expect((res.body as { accruals: unknown[] }).accruals).toEqual([]);
    expect(await deps.store.findUsageEvent('evt-play-1' as never)).toBeDefined();
  });

  it('flags a license violation while still recording the event', async () => {
    const { deps, creationId } = await setup();
    const res = await handleRequest(
      req({
        method: 'POST',
        path: '/v1/events/usage',
        headers: asUser(),
        body: {
          eventId: 'evt-gift-1',
          kind: 'gift', // the seeded license permits creation/streaming/purchase, not gift
          creationId,
          occurredAt: '2026-07-15T20:00:00Z',
          grossAmountMinor: '500',
          currency: 'EUR',
        },
      }),
      deps,
    );
    const body = res.body as {
      licensePermitted: boolean;
      licenseViolations: { reason: string }[];
    };
    expect(res.status).toBe(201);
    expect(body.licensePermitted).toBe(false);
    expect(body.licenseViolations[0]?.reason).toBe('use_not_allowed');
  });

  it('refuses usage reported by a user who does not own the creation', async () => {
    const { deps, creationId } = await setup();
    const res = await handleRequest(
      req({
        method: 'POST',
        path: '/v1/events/usage',
        headers: asUser('someone-else'),
        body: {
          eventId: 'evt-buy-foreign',
          kind: 'purchase',
          creationId,
          occurredAt: '2026-07-15T20:00:00Z',
          grossAmountMinor: '1000',
          currency: 'EUR',
        },
      }),
      deps,
    );
    expect(res.status).toBe(403);
  });

  it('allows a trusted service to report usage for any creation', async () => {
    const { deps, creationId } = await setup();
    const res = await handleRequest(
      req({
        method: 'POST',
        path: '/v1/events/usage',
        headers: asService,
        body: {
          eventId: 'evt-buy-service',
          kind: 'purchase',
          creationId,
          occurredAt: '2026-07-15T20:00:00Z',
          grossAmountMinor: '1000',
          currency: 'EUR',
        },
      }),
      deps,
    );
    expect(res.status).toBe(201);
  });

  it('404s an unknown creation', async () => {
    const deps = makeDeps();
    const res = await handleRequest(
      req({
        method: 'POST',
        path: '/v1/events/usage',
        headers: asUser(),
        body: {
          eventId: 'evt-buy-missing',
          kind: 'purchase',
          creationId: '00000000-0000-4000-8000-999999999999',
          occurredAt: '2026-07-15T20:00:00Z',
          grossAmountMinor: '1000',
          currency: 'EUR',
        },
      }),
      deps,
    );
    expect(res.status).toBe(404);
  });

  it('rejects an amount without a currency', async () => {
    const { deps, creationId } = await setup();
    const res = await handleRequest(
      req({
        method: 'POST',
        path: '/v1/events/usage',
        headers: asUser(),
        body: {
          eventId: 'evt-buy-nocurrency',
          kind: 'purchase',
          creationId,
          occurredAt: '2026-07-15T20:00:00Z',
          grossAmountMinor: '1000',
        },
      }),
      deps,
    );
    expect(res.status).toBe(400);
  });

  it('rejects a fractional amount — money is integer minor units only', async () => {
    const { deps, creationId } = await setup();
    const res = await handleRequest(
      req({
        method: 'POST',
        path: '/v1/events/usage',
        headers: asUser(),
        body: {
          eventId: 'evt-buy-fractional',
          kind: 'purchase',
          creationId,
          occurredAt: '2026-07-15T20:00:00Z',
          grossAmountMinor: 9.99,
          currency: 'EUR',
        },
      }),
      deps,
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /v1/creations/:id/splits', () => {
  it('returns attributed ownership for both copyrights', async () => {
    const deps = makeDeps();
    const seed = seedLicensedStem(deps.store);
    const { creationId } = (await ingestCreation(deps, seed.assetExternalId)).body as {
      creationId: string;
    };

    const res = await handleRequest(
      req({
        method: 'GET',
        path: `/v1/creations/${creationId}/splits`,
        headers: asUser(),
        query: { at: '2026-07-15T00:00:00Z' },
      }),
      deps,
    );

    expect(res.status).toBe(200);
    const body = res.body as {
      composition: { holderId: string; ppm: number; percent: number }[];
      master: { holderId: string; ppm: number }[];
    };
    // Creator keeps 50%; writer and publisher share the other 50% of composition.
    expect(body.composition.reduce((acc, s) => acc + s.ppm, 0)).toBe(1_000_000);
    expect(body.master.reduce((acc, s) => acc + s.ppm, 0)).toBe(1_000_000);
    expect(body.composition.find((s) => s.holderId === 'holder-writer')?.percent).toBe(25);
  });
});

describe('GET /v1/holders/:id/statement', () => {
  it('returns a period statement for the caller’s own holder', async () => {
    const deps = makeDeps();
    const seed = seedLicensedStem(deps.store);
    const { creationId } = (await ingestCreation(deps, seed.assetExternalId)).body as {
      creationId: string;
    };
    await handleRequest(
      req({
        method: 'POST',
        path: '/v1/events/usage',
        headers: asUser(),
        body: {
          eventId: 'evt-buy-stmt',
          kind: 'purchase',
          creationId,
          occurredAt: '2026-07-15T20:00:00Z',
          grossAmountMinor: '1000',
          currency: 'EUR',
        },
      }),
      deps,
    );

    const res = await handleRequest(
      req({
        method: 'GET',
        path: '/v1/holders/holder-label/statement',
        headers: asService,
        query: { from: '2026-07-01T00:00:00Z', until: '2026-08-01T00:00:00Z', currency: 'EUR' },
      }),
      deps,
    );

    expect(res.status).toBe(200);
    const body = res.body as { total: { amountMinor: string }; ruleVersions: string[] };
    expect(BigInt(body.total.amountMinor) > 0n).toBe(true);
    expect(body.ruleVersions).toEqual(['royalty/v1']);
  });

  it('refuses to show one holder’s statement to another user', async () => {
    const deps = makeDeps();
    const res = await handleRequest(
      req({
        method: 'GET',
        path: '/v1/holders/holder-label/statement',
        headers: asUser('maya'),
        query: { from: '2026-07-01T00:00:00Z', until: '2026-08-01T00:00:00Z', currency: 'EUR' },
      }),
      deps,
    );
    expect(res.status).toBe(403);
  });

  it('rejects an inverted or malformed period', async () => {
    const deps = makeDeps();
    const inverted = await handleRequest(
      req({
        method: 'GET',
        path: '/v1/holders/holder-user-maya/statement',
        headers: asUser('maya'),
        query: { from: '2026-08-01T00:00:00Z', until: '2026-07-01T00:00:00Z', currency: 'EUR' },
      }),
      deps,
    );
    expect(inverted.status).toBe(400);

    const badCurrency = await handleRequest(
      req({
        method: 'GET',
        path: '/v1/holders/holder-user-maya/statement',
        headers: asUser('maya'),
        query: { from: '2026-07-01T00:00:00Z', until: '2026-08-01T00:00:00Z', currency: 'eur' },
      }),
      deps,
    );
    expect(badCurrency.status).toBe(400);
  });
});
