# Open questions & flags

Running list of things noticed but deliberately **not** acted on — decisions
deferred, risks spotted in passing, and known gaps. Nothing here is broken work
in this repo; it is the "come back to this" list.

Add to it whenever something gets flagged. When an item is resolved, move it to
**Resolved** at the bottom with the resolution, rather than deleting it.

---

## Security

### S1 — Game repo commits live Supabase credentials *(external repo — not ours to fix)*
`BurstWorldGame2/Config/DefaultGame.ini` contains the live Supabase project URL
and anon key, and `UBDatabaseManager::PrepareRequestHeader` uses the
**service-role key** in `WITH_EDITOR` builds. An anon key in a client is normal;
a service-role key (which bypasses all RLS) circulating in game development is
not. Mitigated for *this* project by ADR 0010 (rights engine got its own
Supabase project), so rights/money data is out of that blast radius — but the
game's own data still sits behind it.
**Owner:** game team. **Severity:** medium-high for game data, none for rights data.

### S2 — The game's live Supabase project isn't in the Burst organisation
`DefaultGame.ini` points at project ref `ihdrcftcmtyvaaabehbe`, but the Burst
org only lists `grvd-daw`, `burst-game-isometric`, and now
`burst-rights-engine`. So the project the shipped game talks to is either under
a different account, or stale. Worth confirming who owns it before anyone
assumes the org list is the full picture.
**Severity:** unknown until identified — could be a forgotten personal-account project holding live user data.

### S3 — No RLS policies written yet (intentional, but must not be forgotten)
Every table has RLS **enabled with zero policies** — deny-by-default. Backend
workers use the service role, which bypasses RLS entirely. The moment any
client reads directly from Postgres instead of through the API, it will get
empty results and someone will be tempted to "fix" it by loosening RLS.
Client-facing policies must be written deliberately, per table, when that need
is real. The Supabase linter reports these as INFO-level notices — those are the
intended posture, not findings.

---

## Product / policy decisions deferred

### P1 — Revenue-share numbers are placeholders
60% platform fee, 50/50 creator-vs-samples, 50/50 composition/master (ADR 0009).
Chosen against the Roblox benchmark, not against real data. Revisit once there
is actual revenue — especially the sampled-creation rate.

### P2 — Attribution v1 ignores *how* an asset was used
`attribution/v1` divides the ingredient pool equally across distinct assets; a
two-bar drum loop and the main vocal hook count the same. Usage-weighted
attribution is the obvious `attribution/v2`, but it needs real usage data to
calibrate. (ADR 0007)

### P3 — Retroactive ownership changes: recompute or not?
The registry can represent a split version with an `effectiveFrom` in the past
(catalog sale, corrected paperwork). Whether that triggers recomputation of
already-accrued royalties — and who absorbs the difference — is an unmade
policy decision. The data supports either answer. (ADR 0005)

### P4 — What happens when a license check fails?
`checkLicenses` flags violations but never blocks; the engine deliberately
leaves the response to an operator (block payout / accrue but withhold /
accrue and alert). No withhold-release workflow exists. (ADR 0011)

### P5 — Non-monetary plays don't accrue anything
`royalty/v1` rejects usage events with no gross amount. If free plays should
ever generate a pro-rata pool (the streaming model), that is a new rule version,
not a change to v1. (ADR 0008)

### P6 — Platform is not a rights-holder in v1
The platform fee is retained money, not a ledger accrual. If Burst should
participate as an actual rights-holder (e.g. on its own sample library, which it
already can via the registry), the accounting distinction between "fee" and
"Burst's rights income" needs deciding. (ADR 0008)

### P7 — No FX policy
Statements are single-currency by design; summing across currencies needs an FX
rate policy with its own versioning problem. Out of scope until multi-currency
revenue is real. (ADR 0011)

---

## EIC / IP

### E1 — Deep-tech positioning is the real EIC risk *(highest-stakes open item)*
EIC WP2026 defines deep tech around lab-derived scientific advance and tangible
industrialisation, explicitly distinguishing it from "high tech." A
TypeScript + Postgres royalty ledger is close to what that wording is drafted to
exclude, and "deep tech and breakthrough nature" sits inside the Excellence
criterion with a hard 4/5 threshold. **This engine should be positioned as
enabling infrastructure and a regulatory/market moat supporting the real-time AI
music model — not as the breakthrough itself.** This qualifies the charter's §2
"second deep-tech pillar" framing and should be settled before application text
is written. (docs/ip-strategy.md)

### E2 — Do not claim the engine is patentable
EPO practice treats "management of rights" as excluded subject-matter, and the
EPO advises the EIC jury on shortlisted proposals. Overclaiming would be read by
an actual examiner. (docs/ip-strategy.md)

### E3 — Priority-filing sequencing trap
If a priority application is filed and then not pursued, it still **publishes at
18 months** — destroying trade-secret status on the disclosed mechanism.
Withdraw before publication if not proceeding. Easy to get wrong.

### E4 — Research caveats not yet closed
No professional prior-art search has been run, so novelty on the ingestion /
provenance angles is unassessed. The exact 2026 Accelerator on-form IP field
wording could not be retrieved (portal 403); criteria came from the Work
Programme and Guide for Applicants v6.0. Re-check Guidelines G-II 3.5.3 / 3.6
against the 2026 official text before relying on it in a filing.

---

## Engineering

### T1 — Serverless connection pooling
Vercel functions open a Postgres connection per invocation. Production must use
Supabase's pooler (pgbouncer, transaction mode) rather than the direct database
host, or connections will exhaust under load.

### T2 — In-memory registry is a reference implementation, not production storage
`InMemoryRegistry` defines the behavioural contract; the Postgres adapter must
stay equivalent to it. Any divergence is a bug in the adapter, and the fix is to
make the adapter pass the registry's tests — not to change the registry.

### T4 — `PostgresStore` has no automated tests
The API test suite runs against `InMemoryStore`; the Postgres adapter's SQL was
verified by hand against the deployed schema (as-of split resolution, the
user-holder upsert, and replayed-usage idempotency all confirmed), but nothing
in CI would catch a regression in it. The fix is a contract test running **both
adapters** against a real Postgres — either Supabase branches or a container in
CI. Worth doing before the API carries real money.

### T5 — Rate limiting and request size limits are not implemented
Ingest endpoints accept up to 1000 recipe entries and unbounded `recipe` JSON.
Vercel caps body size, but there is no per-principal rate limit. Needed before
the API is publicly reachable.

### T3 — Provenance extraction is heuristic until the UE client lands
Falling back to scanning `FTimelineSnapshot` for prefixed-GUID strings is
deliberate and conservative, but the exact prefix set (recordings in
particular) and per-clip usage classification are unverified against the game.
The canonical-entries path makes this a refinement, not a dependency. (ADR 0006)

---

## Resolved

*(none yet)*
