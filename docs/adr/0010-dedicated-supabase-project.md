# ADR 0010 — Dedicated Supabase project for the rights engine

**Date:** 2026-07-23 · **Status:** accepted

## Context

The game (BurstWorldGame2) already runs on a Supabase project, and its client
talks to it directly (`UBDatabaseManager`). The rights engine needs Postgres
for the ownership graph and the money ledger. Reusing the game's project would
be simpler — same auth, same user ids, no cross-project identity mapping.

Two facts weigh against sharing it (see `docs/game-integration-notes.md`):

- The game commits its Supabase URL and anon key in `Config/DefaultGame.ini`.
  Normal for a game client, but it means the project's surface is public.
- Editor builds authenticate with the **service-role key**, which bypasses RLS
  entirely. A key with that power circulating in game development would sit in
  the same project as payout data.

## Decision

The rights engine gets its **own Supabase project**. The game's project keeps
game data; the rights project holds the registry, ledger, and rights-holder
identity/payout data.

Identity crosses the boundary by **verifying the game's JWT**, not by sharing
credentials: the API layer validates the token the game already issues and maps
its user id onto a `rights_holder` row (`rights_holder.user_id`). No
service-role key ever reaches a game build.

## Consequences

- Blast radius is contained: a leaked game key cannot touch money or PII, and
  RLS on the rights project is never bypassed by a client.
- Costs one extra Supabase project (free while prototyping; ~$25/month when it
  needs production guarantees — trivial against the risk).
- Requires cross-project identity mapping and JWT verification in the API layer.
  That work is small and would be needed anyway for a stable, versioned API.
- The game's committed service-role usage remains a issue **in the game repo**,
  independent of this decision; flagged there, not fixed here.
