# ADR 0012 — `attribution/v2`: creation-time AI-contribution attribution

**Date:** 2026-07-24 · **Status:** accepted · **Implements:** roadmap items V3 + V4 (docs/innovation-roadmap.md)

## Context

`attribution/v1` (ADR 0007) is a placeholder: fixed 50% creator share, equal
weight per ingredient asset, no notion of AI contribution. The innovation
roadmap defines the novel core: attribute from **ground-truth telemetry
captured while the music is made** — how much of the final arrangement each
ingredient occupies, which notes were human-played vs AI-generated vs
AI-generated-then-edited, and which artists licensed the training data behind
each AI musician (Kieku's style lineage).

## Decision — `attribution/v2`

### New registry citizen: the AI musician

An `AiMusician` (model id + model version + **licensor shares** per copyright
side) is registered like any rights subject. Its licensor shares are a valid
exact-100% split set over registered rights-holders — the artists (and
platform, if it trained on its own data) behind the model. Structurally an AI
musician is "an ingredient whose rights-holders are its training licensors,"
so the flow-through machinery samples already use applies unchanged.

### Inputs (all integers, all captured at creation time — never inferred)

- **Session telemetry:** `humanNotes`, `aiNotesKept`, `aiNotesEdited` — counted
  by the instrument during the session.
- **Per-contributor telemetry:** `unitsInFinalMix` (integer units — e.g.
  beats × resolution — the contribution occupies in the final arrangement) and
  `origin` (`human_placed` | `ai_generated` | `ai_generated_edited`).
- **Flow-through shares** per side: registry splits for assets, licensor
  shares for AI musicians.

### The rule (per copyright side, all exact-integer ppm)

1. **Creator share is earned, not fixed.** Human credit =
   `humanNotes·SCALE + aiNotesEdited·editedNoteHumanPpm` (an edited AI phrase
   is a joint contribution); total credit counts all kept notes. The creator's
   share interpolates between a policy **floor** (arrangement/curation credit —
   the creator always did *something*) and **ceiling** (the creator never
   captures the ingredients' share entirely):
   `creator = floor + (ceiling − floor) · humanRatio`. No telemetry → policy
   fallback (v1-like fixed share). Monotone by construction: more human
   playing never lowers the creator's share (property-tested).
2. **Ingredient pool** = `SCALE − creator`, distributed across contributors by
   weight = `unitsInFinalMix × originWeight[origin]` via the exact
   largest-remainder distributor. A contributor participates on a side only if
   it carries shares for that side. No rights-bearing contributors → creator
   owns the side fully; all-zero weights → the pool returns to the creator.
3. **Flow-through:** each contributor's portion distributes over its shares;
   holders reached via several routes merge by summation. Output is a valid
   exact-100% split set per side — royalty/v1, the ledger, and statements all
   work unchanged.

### Anti-gaming posture (initial)

Telemetry is counted server-observably (the platform is the instrument), the
creator share is **capped** by the ceiling regardless of note-spamming, weights
scale with *presence in the final mix* (parked, unused material earns nothing),
and the whole computation is deterministic and replayable for audit. A fuller
adversarial analysis stays open as roadmap item V3-b.

### Versioning and coexistence

`attribution/v2` is a new registered rule version; v1 remains the default in
the API until the UE5/Kieku capture spec (roadmap V2) ships real telemetry.
Ledger entries stamp whichever rule priced them; historical runs reproduce.

## Consequences

- The innovation claim now exists as running, property-tested code, not prose:
  a track jammed with an artist's Kieku attributes real shares to that artist.
- **Known gap (flagged in open-questions as T6):** AI-musician licensor shares
  are stored as a single current set in the DB (migration 0004), not yet
  versioned like work/recording splits. The domain rule is version-agnostic
  (shares are inputs), but the store must gain effective-dated licensor share
  versions before the marketplace changes them in production.
