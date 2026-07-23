-- 0001 — Initial rights & royalty schema.
-- Safeguards (charter §6) are structural, not conventions:
--   * money is BIGINT minor units + ISO currency — no floats anywhere
--   * splits sum to exactly 100% (1,000,000 ppm) — deferred constraint trigger
--   * ledger + usage events are append-only — UPDATE/DELETE blocked by trigger
--   * idempotency — unique event ids on every ingested event
--   * RLS enabled on every table, no permissive policies yet (deny-by-default;
--     the service role bypasses RLS, clients get explicit policies later)

create schema if not exists rights;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type rights.asset_kind as enum ('sample', 'loop', 'stem', 'tool_output', 'ai_output');
create type rights.rights_holder_kind as enum
  ('writer', 'publisher', 'artist', 'label', 'user', 'platform', 'collection_society');
create type rights.right_type as enum ('composition', 'master');
create type rights.usage_kind as enum ('play', 'stream', 'purchase', 'gift');

-- ---------------------------------------------------------------------------
-- Registry
-- ---------------------------------------------------------------------------
create table rights.work (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  iswc text,
  created_at timestamptz not null default now()
);

create table rights.recording (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references rights.work (id),
  title text not null,
  isrc text,
  created_at timestamptz not null default now()
);

create table rights.rights_holder (
  id uuid primary key default gen_random_uuid(),
  kind rights.rights_holder_kind not null,
  name text not null,
  -- Optional link to a game user (Supabase auth uid) when kind = 'user'.
  user_id uuid,
  created_at timestamptz not null default now()
);

create table rights.asset (
  id uuid primary key default gen_random_uuid(),
  -- The game's own prefixed-GUID string id (e.g. 'S_…', 'ST_…'), unique when present.
  external_id text unique,
  kind rights.asset_kind not null,
  name text not null,
  work_id uuid references rights.work (id),
  recording_id uuid references rights.recording (id),
  created_at timestamptz not null default now(),
  constraint asset_links_some_right check (work_id is not null or recording_id is not null)
);

-- ---------------------------------------------------------------------------
-- Versioned splits — append-only; a change creates a NEW version
-- ---------------------------------------------------------------------------
create table rights.split_version (
  id uuid primary key default gen_random_uuid(),
  right_type rights.right_type not null,
  work_id uuid references rights.work (id),
  recording_id uuid references rights.recording (id),
  version integer not null check (version >= 1),
  effective_from timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- exactly one subject
  constraint split_subject_exactly_one
    check ((work_id is null) <> (recording_id is null)),
  -- composition splits attach to works, master splits to recordings
  constraint split_subject_matches_right_type check (
    (right_type = 'composition' and work_id is not null)
    or (right_type = 'master' and recording_id is not null)
  ),
  constraint split_version_unique_per_subject
    unique nulls not distinct (right_type, work_id, recording_id, version)
);

create table rights.split_share (
  split_version_id uuid not null references rights.split_version (id),
  holder_id uuid not null references rights.rights_holder (id),
  -- parts-per-million of 100%; the whole version must sum to exactly 1,000,000
  ppm bigint not null check (ppm > 0 and ppm <= 1000000),
  primary key (split_version_id, holder_id)
);

-- Invariant: shares of every split version sum to exactly 1,000,000 ppm.
-- Deferred to commit so a version + its shares can be inserted in one transaction.
create or replace function rights.check_split_sum() returns trigger
language plpgsql as $$
declare
  affected uuid;
  total bigint;
begin
  affected := coalesce(new.split_version_id, old.split_version_id);
  select coalesce(sum(ppm), 0) into total
  from rights.split_share where split_version_id = affected;
  if total <> 1000000 then
    raise exception 'split_version % shares sum to % ppm; must be exactly 1000000', affected, total;
  end if;
  return null;
end;
$$;

create constraint trigger split_share_sum_is_100_percent
  after insert or update or delete on rights.split_share
  deferrable initially deferred
  for each row execute function rights.check_split_sum();

-- ---------------------------------------------------------------------------
-- Licenses
-- ---------------------------------------------------------------------------
create table rights.license (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references rights.asset (id),
  -- ISO 3166-1 alpha-2 codes; empty array = worldwide
  territories text[] not null default '{}',
  allowed_uses text[] not null default '{}',
  revenue_share_ppm bigint not null check (revenue_share_ppm >= 0 and revenue_share_ppm <= 1000000),
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Provenance — creations and their recipes (ingested events)
-- ---------------------------------------------------------------------------
create table rights.creation (
  id uuid primary key default gen_random_uuid(),
  -- Idempotency key of the provenance event from the client; replays are no-ops.
  event_id text not null unique,
  -- The game's soundtrack id (e.g. 'ST_…').
  external_id text unique,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  -- Raw recipe as received (FTimelineSnapshot JSON), kept verbatim for audit/replay.
  raw_recipe jsonb not null
);

create table rights.provenance_entry (
  creation_id uuid not null references rights.creation (id),
  asset_id uuid not null references rights.asset (id),
  usage text not null,
  primary key (creation_id, asset_id, usage)
);

-- ---------------------------------------------------------------------------
-- Usage events + royalty ledger — append-only, idempotent
-- ---------------------------------------------------------------------------
create table rights.usage_event (
  id uuid primary key default gen_random_uuid(),
  -- Client-generated idempotency key; unique constraint makes replays no-ops.
  event_id text not null unique,
  kind rights.usage_kind not null,
  creation_id uuid not null references rights.creation (id),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  -- Gross revenue in integer minor units; null for non-monetary events (free plays).
  gross_amount_minor bigint,
  currency char(3),
  territory char(2),
  constraint usage_money_complete
    check ((gross_amount_minor is null) = (currency is null))
);

create table rights.ledger_entry (
  id uuid primary key default gen_random_uuid(),
  usage_event_id uuid not null references rights.usage_event (id),
  holder_id uuid not null references rights.rights_holder (id),
  right_type rights.right_type not null,
  -- Integer minor units; negative entries are explicit reversals/corrections.
  amount_minor bigint not null,
  currency char(3) not null,
  -- The exact rule version that computed this entry — historical runs must reproduce.
  rule_version text not null,
  created_at timestamptz not null default now()
);

create index ledger_entry_holder_idx on rights.ledger_entry (holder_id, created_at);
create index ledger_entry_event_idx on rights.ledger_entry (usage_event_id);

-- Append-only enforcement: history is immutable; corrections are new negating rows.
create or replace function rights.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only: % not allowed', tg_table_name, tg_op;
end;
$$;

create trigger ledger_entry_append_only
  before update or delete on rights.ledger_entry
  for each row execute function rights.forbid_mutation();

create trigger usage_event_append_only
  before update or delete on rights.usage_event
  for each row execute function rights.forbid_mutation();

create trigger creation_append_only
  before update or delete on rights.creation
  for each row execute function rights.forbid_mutation();

create trigger split_version_append_only
  before update or delete on rights.split_version
  for each row execute function rights.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Row-Level Security: ON everywhere, deny-by-default (no policies yet).
-- Backend workers use the service role (bypasses RLS); client-facing read
-- policies will be added deliberately, per table, in later phases.
-- ---------------------------------------------------------------------------
alter table rights.work enable row level security;
alter table rights.recording enable row level security;
alter table rights.rights_holder enable row level security;
alter table rights.asset enable row level security;
alter table rights.split_version enable row level security;
alter table rights.split_share enable row level security;
alter table rights.license enable row level security;
alter table rights.creation enable row level security;
alter table rights.provenance_entry enable row level security;
alter table rights.usage_event enable row level security;
alter table rights.ledger_entry enable row level security;
