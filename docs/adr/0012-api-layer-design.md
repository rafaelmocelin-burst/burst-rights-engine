# ADR 0012 — API layer: framework-agnostic router, ports, transactional money path

**Date:** 2026-07-23 · **Status:** accepted

## Context

The API is the contract the UE5 client and storefront build against, and it is
the only path by which money enters the ledger. It runs on Vercel (charter §7:
thin API + UI there; data and heavy jobs on Supabase).

## Decision

**Routing is framework-agnostic.** `handleRequest(ApiRequest) → ApiResponse` is
a pure-ish function over normalized request/response objects. The Vercel handler
is a ~40-line translation layer. Consequence: the entire API — routing, auth
gating, validation, status codes, error shapes — is tested without starting a
server, and moving off Vercel would not touch a line of logic.

**Storage is behind ports.** Handlers depend on the `RightsStore` interface
only. Two adapters implement it: `InMemoryStore` (tests, local dev) and
`PostgresStore` (production). The API test suite runs against the in-memory
adapter and is a genuine contract both must satisfy.

**The money path is one transaction.** `appendUsageWithLedger` inserts the usage
event and all its ledger entries in a single transaction with
`on conflict (event_id) do nothing`. This is deliberate:

- An event can never be committed without its accruals, or vice versa.
- Idempotency is defended **twice** — a pre-check read, and the unique
  constraint inside the transaction. The pre-check is an optimisation; the
  constraint is the guarantee. Two concurrent identical events accrue exactly
  once, and the loser returns the winner's entries rather than an error.

**Splits resolve as-of the event instant**, not "now" — `distinct on … order by
effective_from desc, version desc` in SQL, mirroring `InMemoryRegistry.splitsAt`.
A late-arriving event from an offline client prices with the ownership that was
effective when it happened.

**Money crosses the wire as decimal strings of minor units.** JSON numbers are
doubles; a large accrual would lose precision silently. Fractional values are
rejected outright.

**Authorization**: a user principal may act on their own creations and read
their own statement; a service principal (storefront, batch workers) may act
broadly. Verified from the game's JWT — no shared service-role key (ADR 0010).

**Errors are opaque.** Unexpected failures log server-side and return a bare
500; auth failures never say *why* (that is an oracle for token forgery).
Clients branch on a stable `code`, never on prose.

## Consequences

- The UE5 thin client can be built against `docs/api-v1.md` before any of it is
  deployed, and its retry queue is safe because every ingest is idempotent.
- `PostgresStore` is not yet exercised by automated tests (it needs a live
  database). Its SQL was verified by hand against the deployed schema; a
  contract test running both adapters against a real Postgres is the obvious
  next hardening step, tracked in `docs/open-questions.md`.
- Serverless connection pooling is a deployment requirement, not an
  optimisation: the pooler URL is mandatory (T1 in open questions).
