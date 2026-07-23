# ADR 0005 — Registry semantics: append-only split versions, effective-dated resolution

**Date:** 2026-07-23 · **Status:** accepted

## Context

Phase 1 needs the rights registry: works, recordings, assets, rights-holders,
and fractional ownership that changes over time (catalog sales, renegotiations,
corrections) without ever breaking the reproducibility of past royalty runs.

## Decision

- **Split versions are append-only.** A change in ownership NEVER edits a
  version; it appends a new one. Version numbers are assigned by the registry
  (max + 1), never by callers.
- **Resolution is effective-dated and deterministic:** the version in effect at
  instant `t` is the one with the latest `effectiveFrom <= t`; ties (same
  `effectiveFrom`) resolve to the highest version number, which makes
  "correct a mistake as of the same date" a well-defined operation.
- **Every version is validated on entry**: shares sum to exactly 1,000,000 ppm,
  all holders registered, composition splits attach to works, master splits to
  recordings, assets must link a work and/or recording, and an asset's
  recording must belong to its work.
- **The in-memory registry is the reference implementation.** Its test suite is
  the behavioural contract; the Postgres adapter added with the API layer must
  pass equivalent tests. `external_id` maps the game's prefixed-GUID ids
  (`S_…`, `ST_…`) onto registry assets.

## Consequences

- Royalty runs can ask "who owned this on date X" for any X, forever, and get
  the same answer — the foundation Phases 3–4 build on.
- Retroactive ownership changes (effectiveFrom in the past) are representable;
  whether recomputation of already-accrued royalties is triggered is a Phase 4+
  policy decision, recorded separately when made.
