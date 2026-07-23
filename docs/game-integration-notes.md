# BurstWorldGame2 — integration notes for the rights engine

*Surveyed 2026-07-23 from `C:\Users\rafin\Documents\GitHub\BurstWorldGame2` (read-only).
These notes inform Phases 2–4; nothing here modifies the game.*

## What the game already has

- **UE 5.3**, single runtime C++ module `BurstWorldGame`; `HTTP`, `Json`,
  `JsonUtilities` already in `Build.cs` — the thin client needs no new engine deps.
- **A working Supabase backend already exists**: `UBDatabaseManager`
  (`Source/BurstWorldGame/…/Database/BDatabaseManager.*`, an **EngineSubsystem**)
  calls Supabase auth (`/auth/v1/*`), PostgREST (`/rest/v1/{profiles, drum_presets,
  samples, recordings, soundtracks, inventory, player_saves}`), and Storage
  (WAV upload/download). Auth = anon key + user access token in shipping builds.
- **Provenance already ships in embryo**: soundtrack uploads send a
  `FTimelineSnapshot` JSON (tracks → clips → asset IDs) via
  `UploadSoundtrackSnapshot`. That snapshot *is* the creation "recipe" —
  Phase 2 ingestion should accept it near-verbatim (stored in
  `rights.creation.raw_recipe`) and normalize into `provenance_entry` rows.
- **Asset identity**: prefixed GUID strings (`S_…` samples, `ST_…` soundtracks,
  `Clip_…`, `Track_…`) generated in `UBGameStatics`; rich metadata in
  `FAudioItemInfo` (ID, name, BPM, price, pack IDs, tags, key). The registry's
  `asset.external_id` / `creation.external_id` columns map to these.
- **Ownership signals**: `samples`/`recordings` rows carry `owner_id`;
  `soundtracks` carry `user_id` + `artist_name` — the seed data for
  user-kind rights-holders.
- **Economy is stubbed, not built**: `Price` on audio items, an
  `EItemIsIn::Marketplace` enum, coins/XP in `UBSaveGame` — but no purchase,
  transaction, or gifting flow yet. Usage-event emit points for
  purchase/gift get added when that system is built; `play` events can hook
  concert/preview playback (`BConcert`, `BPreviewAudioSubsystem`).
- **No analytics/telemetry framework exists** — the rights client will be the first.

## Plan for the thin client (Phase 2)

New `UBRightsTelemetrySubsystem` as a **GameInstanceSubsystem** in
`Source/BurstWorldGame/…/Subsystems/`, per the charter. Reuse the header/auth
pattern from `UBDatabaseManager::PrepareRequestHeader`, but do **not** copy its
fire-and-forget style: the rights client adds what the charter requires and the
current manager lacks — an off-game-thread local persistent queue, retry with
backoff, and a client-generated `event_id` (idempotency key) on every event.

Emit points to hook:
- `UploadSoundtrackSnapshot` → provenance event (creation + recipe)
- `UploadAudioAsset` / `UploadDrumPreset` → asset registration events
- concert/preview playback → `play` usage events
- future marketplace flows → `purchase` / `gift` usage events

## Flags for the security posture (game repo, not this repo)

- `Config/DefaultGame.ini` has the live Supabase URL + anon key committed, and
  editor builds use the **service-role key** in `PrepareRequestHeader`. Anon key
  in a client is normal; the committed service-role path deserves review before
  the rights tables (money/PII) share that Supabase project.
- **Open decision (needs an ADR before Phase 2 deploy):** same Supabase project
  as the game (simpler auth reuse, riskier blast radius) vs. a dedicated
  rights-engine project (clean isolation, cross-project identity mapping).
  Leaning: dedicated project + verified JWTs, but decide when the API layer lands.
