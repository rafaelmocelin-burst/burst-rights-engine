# Burst — Music Rights & Royalty Engine

Music licensing, rights-attribution, and royalty engine for Burst (the social music game).
It captures provenance for every user creation, resolves fractional ownership across both
copyrights (composition + master), accrues royalties from usage events into an append-only
auditable ledger, enforces license terms, and produces statements and payout exports.

**Charter and operating rules:** see [CLAUDE.md](CLAUDE.md) — read it first, every session.

## Layout

| Path | What |
| --- | --- |
| `packages/domain` | Pure, deterministic domain core (money, splits, attribution, ledger math). No I/O, no framework. The crown jewels. |
| `supabase/migrations` | Versioned, forward-only Postgres migrations (Supabase CLI). |
| `docs/adr` | Architecture Decision Records. |
| `.github/workflows` | CI — every merge gates on green tests. |

## Invariants (enforced in code, DB, and tests)

- No floating point for money — `bigint` minor units only.
- Ownership splits always sum to exactly 100% (1,000,000 ppm) — DB constraint + property tests.
- Royalty allocation conserves money exactly (largest-remainder, deterministic tie-break).
- Ledger is append-only — UPDATE/DELETE blocked by trigger; idempotency via unique event IDs.
- Every ledger entry is tagged with the rule version that produced it — historical runs reproduce exactly.

## Development

```bash
npm install
npm run typecheck
npm test
```

Database migrations use the Supabase CLI (`npx supabase ...`); never hand-edit a live schema.
