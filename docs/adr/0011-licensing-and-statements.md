# ADR 0011 — Licensing checks flag (not block); statements are pure folds

**Date:** 2026-07-23 · **Status:** accepted

## Context

Phase 5 covers license enforcement and reporting. Two design questions:
what happens when a usage violates a license, and how statements relate to
the ledger.

## Decision — licensing

- The license check is **separate from the money math** and **flags rather than
  blocks**. It returns `{permitted, violations}`; the caller decides the
  response (block payout, accrue-but-withhold, accrue-and-alert). The engine
  makes the fact undeniable and auditable; policy belongs to an operator.
- **Any license covering the usage clears the asset** — assets legitimately
  carry several licenses (per territory, per use). When all fail, the most
  specific failure is reported (expired > not-yet-valid > territory > use),
  because that is the most actionable for whoever investigates.
- **An unknown territory cannot clear a territory-restricted license.** Absence
  of data is not permission. A worldwide license (empty territory list) still
  clears it.
- Every offending asset is reported, not just the first.

## Decision — statements

- A statement is a **pure fold over ledger entries in a half-open period**
  `[from, until)`. No stored state, so regenerating a historical statement
  yields identical numbers, and consecutive periods can never double-count a
  boundary entry.
- Reversals need no special handling: they are ordinary negative entries that
  net out.
- **Single currency per statement.** Summing across currencies requires an FX
  policy with its own rate-versioning problem; out of scope, so a holder
  earning in several currencies gets one statement each.
- **Payout rows include only strictly positive balances.** Negative balances
  stay in the ledger and offset the next period automatically — no clawback
  logic needed.
- Payout CSV writes **integer minor units**, never decimal strings, so no
  formatting step can corrupt a figure en route to a payment provider.

## Consequences

- Reporting adds no new persistence and cannot drift from the ledger.
- A withhold/release workflow for flagged usages is a later product decision;
  the data to drive it already exists.
