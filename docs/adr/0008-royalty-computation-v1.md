# ADR 0008 — Royalty computation v1: fee → pools → conservation-exact allocation

**Date:** 2026-07-23 · **Status:** accepted

## Context

Phase 4 turns monetary usage events into ledger accruals. The non-negotiables
(charter §6): exact conservation, determinism, versioning, idempotency, and
reversals that mirror the original exactly.

## Decision — `royalty/v1`

1. **Pipeline:** gross → platform fee (policy ppm, truncated toward zero) →
   net → composition pool vs master pool (policy ppm, remainder to master) →
   each pool allocated across the creation's attributed split set with the
   largest-remainder allocator from ADR 0003.
2. **Conservation is structural:** fee + all entries == gross by construction
   (each stage assigns a remainder, never rounds independently) — and
   property-tested across positive and negative gross.
3. **The platform fee is retained money, not a rights-holder accrual** in v1.
   If the platform later participates as a rights-holder, that ships as a new
   rule version — no schema change needed now.
4. **Reversals are negative-gross events** through the same rule; truncation
   toward zero makes `royalty(−x)` exactly `−royalty(x)`, so a refund clears
   an accrual to the cent.
5. Zero-amount drafts are dropped (micro-events routinely floor most holders
   to zero); conservation still holds because dropped entries are exactly 0.
6. **Idempotency lives in the store**, not the rule: the unique
   `usage_event.event_id` plus one-computation-per-event discipline in the
   worker (enforced when the async worker lands) prevents double-counting.
7. Non-monetary events (plays without payout) are rejected by `royalty/v1`;
   play-count-based pools are a future rule version.

## Consequences

- End-to-end money flow (event → fee → pools → holders) is pure and replayable;
  the async worker (later phase) is a thin shell that reads inputs, calls the
  rule, and appends drafts stamped `royalty/v1` to the ledger.
- Default policy numbers (30% fee, 50/50 pools) are placeholders supplied by
  the caller; the recorded rule version + persisted policy make every historical
  figure explainable.
