# Burst — Music Rights & Royalty Engine
### Project Charter & Agent Operating Guide  ·  v1 · 13 July 2026

> **Read this first, every session.** This is the single source of truth for the project: the vision, the plan, the outcomes, the rules, and how to work in this folder. It is a *living* document — keep it accurate; update it whenever scope, architecture, or a key decision changes.
>
> **If you are Claude Code (or any coding agent):** copy or rename this file to `CLAUDE.md` so it is auto-loaded as context on every session.

---

## 0. Operating rules — non-negotiable
1. **This project is isolated.** All work happens inside this folder (`Music Rights Engine/`) and its Git repository. 
2. **Do NOT touch the EIC application.** Never read, edit, move, or depend on files in the parent `EU EIC APPLICATION` folder or its `Application 2026` subfolder. That is the grant application; it is managed separately, by hand, elsewhere. This project must not modify it.
3. **Code lives in Git (GitHub), not in Dropbox.** This folder can hold the repo clone, design docs, and reference assets — but the source of truth for code is the GitHub repository.
4. **Never commit secrets.** Environment variables + a secrets manager only. `.env` is git-ignored.
5. **Correctness and auditability beat speed.** This handles money and rights. When in doubt, choose the safe, reversible, auditable option, and write a test.

---

## 1. Vision
Burst is the first social music game where music rights are handled **automatically and fairly**. Every sample, producer contribution, and user creation is tracked; every rights-holder is correctly credited; royalties are computed and paid at scale — with **no manual clearing**. This engine is the technology that makes that true.

## 2. Goal
Build a **music licensing, rights-attribution, and royalty engine** that plugs into Burst (Unreal Engine 5.3) and, for any platform or user-created music, automatically:
- **captures** what went into it (provenance),
- **resolves** who owns what (attribution / ownership splits),
- **computes and accrues** royalties from usage,
- **enforces** license terms,
- **produces** auditable statements and payout files.

**Secondary goal:** this becomes a **second deep-tech pillar** for the EIC application — a defensible technical *and* regulatory moat. Build it right for its own sake; done well, it becomes evidence.

## 3. Clear outcomes — definition of done (v1)
A working system where:
- [ ] Every **asset** (sample, loop, stem, producer-tool output, AI output) is in a rights registry with ownership splits for **both** copyrights — *composition* and *master*.
- [ ] Every user creation emits a **provenance record** (its "recipe") from the UE5 client.
- [ ] The **attribution engine** turns a creation's recipe into fractional splits that **always sum to exactly 100%**, deterministically and reproducibly.
- [ ] **Usage events** (play, purchase, stream, gift) accrue royalties to the correct rights-holders in an **append-only, auditable ledger**, with **no double-counting**.
- [ ] **License rules** are enforced or flagged (territory, allowed use, revenue share).
- [ ] **Statements and payout exports** can be generated for any period, and any historical calculation can be reproduced exactly.

---

## 4. Context (why this exists)
This spun out of the Burst EIC Accelerator resubmission. The EIC funds *deep tech* — a technological breakthrough — not "a game." Burst's primary deep-tech asset is a real-time AI music-generation model, but running AI at scale is costly. The rights engine emerged as a **distinctive, lower-cost, highly defensible** technology angle that can stand alongside (or, if needed, partly substitute for) the AI on the Excellence criterion.

The hard problem, in brief: every piece of music carries **two separate copyrights** — the *composition* (song; writers/publishers) and the *master* (recording; artist/label) — and ownership is **fractional and fragmented** across writers, publishers, labels, and collection societies (ASCAP, PRS, Finland's Teosto, etc.), with no single clean database. User-generated + AI-assisted music multiplies the ambiguity. Doing attribution and micro-royalty payment **automatically, at scale** is the valuable, unsolved problem this engine targets.

---

## 5. Architecture — cost-optimal, low-latency, low-GPU *by design*
**Key principle: rights & royalty logic is a backend data problem, NOT a real-time game problem. Keep it entirely out of the GPU / render path.** The game makes only lightweight calls; the brain lives in the backend. This is exactly what makes it cheap, low-latency, and free of any graphics-card burden. The Unreal side is a *thin client*, nothing more.

**Layers (dependencies point inward):**
1. **UE 5.3 thin client (C++).** Emits provenance events (which asset IDs went into a creation) and usage events (play/purchase/gift); queries license status. Built on the engine's HTTP module, in a dedicated subsystem, running **off the game thread** with a local persistent queue + retry so network hiccups never affect gameplay. No ML, no heavy compute, no GPU.
2. **API layer.** Stable, **versioned** REST/RPC endpoints: ingest events, query rights/status.
3. **Domain core (pure, framework-agnostic).** The attribution + royalty math. Knows nothing about HTTP or the database. Fully unit-testable in isolation. **This is the crown jewels — keep it pure and deterministic.**
4. **Persistence — Postgres (Supabase).** Relational ownership graph; **ACID** transactions for money; append-only ledger tables.
5. **Async workers.** Heavy royalty computation and statement generation run as background/batch jobs (queue or scheduled) — **never in the request path**.
6. **Reporting / payout / admin.** Dashboards + exports (PRO/publisher formats, payout files).

**Core domain entities (model these explicitly):** `Work` (composition), `Recording` (master), `Asset` (sample/loop/stem/tool output → links to a Work and/or Recording), `RightsHolder`, `Split` (fractional, versioned), `License` (terms), `Creation` (user track + provenance recipe), `UsageEvent`, `LedgerEntry` (append-only accrual).

---

## 6. Build-right-from-the-ground-up — mandatory safeguards
Because this handles money and rights across many iterations over time, these are non-negotiable from **day one**, not "later":
- **Event-sourcing / append-only ledger.** Never mutate historical money/rights records — store immutable events, derive state. Full audit trail.
- **Idempotency everywhere.** Every event carries a unique ID; reprocessing must never double-count royalties.
- **Deterministic + versioned rules.** Attribution/royalty logic is pure and **versioned**, so any past calculation reproduces exactly. Tag every ledger entry with the rule version used.
- **No floating point for money — ever.** Integer minor units or a Decimal type.
- **Splits always sum to 100%.** Enforce as a DB constraint + a property-based test.
- **Domain-driven, layered design.** Pure domain core isolated from framework/DB/HTTP.
- **Test-first on the money math.** Unit + property-based tests (splits conserve; royalties conserve; idempotency holds). **CI gates every merge on green tests.**
- **Versioned DB migrations** (Supabase CLI), forward-only, reviewed. Never hand-edit a live schema.
- **Security & PII.** Rights-holder identity + payout data is sensitive: Supabase **Row-Level Security** from the start, least-privilege, secrets in a manager, audit logging of access.
- **Observability.** Structured logging + traceability so any royalty figure can be explained ("why did X receive Y?").
- **Stable, versioned API contract** so the UE client and backend evolve independently.
- **ADRs (Architecture Decision Records).** One short markdown note per significant decision, in `/docs/adr`, so future iterations understand the *why*.

---

## 7. Tooling — tailored advice for your stack
- **GitHub — source of truth for code.** One repo. Branch protection on `main`, PRs + review, CI running tests on every PR, conventional commits, a `CHANGELOG`. This is where "behaves well across many iterations" actually lives — enforce it from commit #1.
- **Supabase — ideal fit.** The relational ownership graph and the money ledger need Postgres's ACID guarantees. Use it for the registry, ledger, and auth. Use the **Supabase CLI for versioned migrations**, enable **RLS** from the start, and use edge functions / `pg_cron` for scheduled royalty batch jobs.
- **Vercel — API + dashboard only.** Great for the versioned API and a reporting/admin web UI. **Caveat:** Vercel serverless functions have short execution-time limits — do **not** run long royalty batch jobs there. Batch/heavy jobs go in Supabase edge functions / scheduled jobs / a queue. Rule of thumb: **Vercel = thin API + UI; Supabase = data + heavy jobs.**
- **Unreal Engine 5.3 — thin client in C++.** Implement event emission in a dedicated `GameInstanceSubsystem` using the built-in HTTP module, off the game thread, with a local persistent queue + retry. Expose Blueprint hooks for designers. **All rights logic stays server-side.** Nothing here needs a GPU.
- **Blender — not part of this engine.** (If 3D/cosmetic assets ever need their own licensing tracking, the same registry can hold them — out of v1 scope.)
- **Dropbox — assets/docs only.** Use it for heavy binary reference assets or shared documents. **Never** as the code store or a database. Code = GitHub; data = Supabase.
- **Claude / Claude Code — build here.** See §9. Keep this file as the repo's `CLAUDE.md` so it is auto-loaded each session.

---

## 8. Phased plan (milestones)
- **Phase 0 — Foundations.** Repo scaffold, CI, domain model, DB schema + migrations, safeguards baked in (append-only ledger, idempotency, decimal money, test harness). No features yet — get the skeleton right.
- **Phase 1 — Rights registry.** Assets, works, recordings, rights-holders, versioned splits; enforce the 100% invariant.
- **Phase 2 — Provenance capture.** UE5 thin client emits creation recipes; backend ingests and stores them.
- **Phase 3 — Attribution engine.** Resolve a creation's recipe → fractional splits (deterministic, versioned).
- **Phase 4 — Royalty ledger.** Usage events → accrual → append-only, auditable ledger; idempotent.
- **Phase 5 — Licensing rules + reporting.** Enforce license terms; generate statements + payout exports.
- **Phase 6 — Hardening + EIC demo.** Scale tests, audit trail, and a clean end-to-end demo of automatic attribution — the evidence artifact for the grant.

**Each phase ends with:** passing tests + an ADR + this document updated. Do not start the next phase until the current one is green.

---

## 9. Where to build it — Claude Code, not Cowork
Build the engine in **Claude Code**. This is a real software project — Unreal C++, a backend service, a database, CI, evolving over many iterations. Claude Code is the coding agent: git-native, works across a whole codebase, runs tests, wires up CI. Cowork (where this plan was written) is for documents, research, and file tasks — keep using it for the EIC application and planning, not for building and maintaining this codebase.

Recommended start in Claude Code: create the GitHub repo, drop this file in as `CLAUDE.md`, and begin **Phase 0**.

---

## 10. Change log
- **v1.1 — 23 Jul 2026.** Phase 0 (Foundations) built and green. Repo created at `C:\Users\rafin\Documents\GitHub\burst-rights-engine` (clone kept outside Dropbox — ADR 0004; this charter mirrored there as `CLAUDE.md`). Stack: TypeScript npm-workspaces monorepo; pure domain core `@burst/domain` (bigint minor-unit money, integer-ppm splits, largest-remainder allocation, versioned rule registry) with 22 passing unit + property tests; initial Supabase migration (append-only ledger/usage/creation tables, deferred 100%-split constraint trigger, event-id idempotency, RLS deny-by-default); GitHub Actions CI; ADRs 0001–0004. Game repo surveyed (read-only): UE 5.3 with an existing Supabase client (`UBDatabaseManager`) and soundtrack "snapshot" recipes — see `docs/game-integration-notes.md` in the repo. GitHub remote not yet created (no `gh` CLI on machine). Next: push to GitHub, then Phase 1 (rights registry).
- **v1 — 13 Jul 2026.** Charter created (vision, goal, outcomes, architecture, safeguards, tooling, phased plan).
