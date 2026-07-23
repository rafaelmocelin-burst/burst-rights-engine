# ADR 0006 — Provenance ingestion: canonical entries with snapshot fallback

**Date:** 2026-07-23 · **Status:** accepted

## Context

Phase 2 captures each creation's "recipe". The game already uploads a
`FTimelineSnapshot` JSON with soundtracks; the future UE5 rights client will
send a canonical entries list. Field names inside the snapshot belong to the
game and may evolve.

## Decision

- The ingest API accepts a **canonical `entries` list**
  (`{assetExternalId, usage}`) as the preferred input, and stores the **raw
  recipe JSON verbatim** (`creation.raw_recipe`) for audit and replay.
- When entries are absent, the ingester **extracts asset references from the
  snapshot conservatively**: it scans all string values for the game's
  prefixed-GUID pattern, excludes container prefixes (`ST_`, `Clip_`,
  `Track_`), and lets the registry decide what is a known asset. No coupling
  to the snapshot's field names.
- **Unknown references are flagged (`unresolved`), never dropped silently** —
  an unregistered sample in a recipe is a rights problem to surface, not noise.
- **Idempotency:** the client-generated `eventId` is the key; replays return
  the existing creation and write nothing.

## Consequences

- The backend works with today's game data without any game change, and gets
  strictly better when the thin client lands with explicit entries.
- Extraction accuracy (e.g. recordings' exact prefix, usage classification per
  clip type) is verified against the game during the UE client work — the
  canonical path makes that a refinement, not a dependency.
