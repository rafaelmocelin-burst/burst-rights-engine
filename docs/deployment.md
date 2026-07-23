# Deployment

## Supabase

The rights engine runs on its **own** Supabase project, separate from the
game's (ADR 0010).

| | |
| --- | --- |
| Organization | `Burst` |
| Project | `burst-rights-engine` |
| Region | `eu-north-1` (Stockholm) — EU data residency for rights-holder PII and payout data |
| Schema | `rights` |

The project ref and keys are **not** committed. Read them from the Supabase
dashboard into environment variables (`.env`, git-ignored):

```
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # backend workers only — never in a game build
```

## Migrations

`supabase/migrations/` is the source of truth, applied in filename order and
forward-only. Never hand-edit a live schema; add a new migration instead.

Applied so far:

| Migration | What |
| --- | --- |
| `20260723000001_initial_schema.sql` | Full rights/royalty schema: registry, versioned splits, licenses, provenance, usage events, ledger. All safeguards. |
| `20260723000002_pin_function_search_path.sql` | Pin `search_path` on the trigger functions (security linter WARN). |

## Safeguards verified against the live database

Run after any schema change. Each was confirmed on 2026-07-23:

- A split version whose shares sum to 999,999 ppm is **rejected** at commit
  (`split_version … shares sum to 999999 ppm; must be exactly 1000000`).
- A split version summing to exactly 1,000,000 ppm is accepted.
- `UPDATE` on `ledger_entry` is **blocked** (`ledger_entry is append-only`).
- `DELETE` on `ledger_entry` is **blocked**.
- A replayed `usage_event.event_id` is **rejected** by the unique constraint
  (idempotency — no double-counting).

Verification runs inside a transaction that ends in a deliberate exception, so
it leaves no rows behind.

## Security posture

- RLS is **enabled on every table with no policies** — deny-by-default. Backend
  workers use the service role (which bypasses RLS); client-facing read policies
  get added deliberately, per table, when the API layer lands.
- Trigger function `search_path` is pinned.
- The Supabase security linter reports only INFO-level
  `rls_enabled_no_policy` notices, which are the intended posture, not findings.
