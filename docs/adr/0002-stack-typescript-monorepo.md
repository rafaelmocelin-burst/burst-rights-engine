# ADR 0002 — TypeScript monorepo with a pure domain core

**Date:** 2026-07-23 · **Status:** accepted

## Context

The charter mandates a layered design: a pure, framework-agnostic domain core
(attribution + royalty math), a thin versioned API on Vercel, Postgres on
Supabase, and async workers for heavy computation. The UE 5.3 client is C++,
but all rights logic is server-side.

## Decision

- **Language: TypeScript** for the backend. One language across domain core,
  API routes (Vercel), and Supabase edge functions (Deno speaks TS); strong
  typing for the ownership graph; `bigint` gives exact integer money natively.
- **Repo layout: npm workspaces monorepo** (`packages/*`). npm (not pnpm) because
  it is already on the dev machine and CI runners; zero extra toolchain.
- **`@burst/domain` is dependency-free at runtime** — no HTTP, no DB, no clock,
  no randomness. Anything impure lives in outer layers that *call* the domain.
  This is enforced culturally now; a lint rule can enforce it mechanically later.
- **Tests: Vitest + fast-check.** Property-based tests are first-class citizens
  because the core invariants (conservation, determinism) are properties, not
  examples.
- **Strict TS everywhere**: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`.

## Consequences

- The domain core can be unit-tested in milliseconds and reused verbatim from
  Vercel functions, Supabase edge functions, and batch workers.
- The UE client never links any of this — it only speaks the versioned HTTP API
  (Phase 2), so language choice here does not constrain the game.
