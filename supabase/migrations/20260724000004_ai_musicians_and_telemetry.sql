-- 0004 — AI musicians (Kiekus) + creation-time contribution telemetry (ADR 0012).
--
-- An AI musician is a specific model version whose training data was licensed
-- from identifiable artists; its licensor shares are exact-100% split sets the
-- attribution engine flows royalties through. Telemetry columns store the
-- ground truth captured while the music was made — never inferred afterwards.

create table rights.ai_musician (
  id uuid primary key default gen_random_uuid(),
  -- The game/Kieku-side identifier for this musician, unique when present.
  external_id text unique,
  name text not null,
  model_id text not null,
  model_version text not null,
  created_at timestamptz not null default now(),
  -- A retrained model is a NEW row — lineage may differ.
  constraint ai_musician_identity unique (model_id, model_version)
);

create table rights.ai_musician_licensor_share (
  ai_musician_id uuid not null references rights.ai_musician (id),
  right_type rights.right_type not null,
  holder_id uuid not null references rights.rights_holder (id),
  ppm bigint not null check (ppm > 0 and ppm <= 1000000),
  primary key (ai_musician_id, right_type, holder_id)
);

-- Same exact-100% discipline as split_share, per (musician, side), deferred to commit.
create or replace function rights.check_licensor_share_sum() returns trigger
language plpgsql as $$
declare
  m uuid;
  rt rights.right_type;
  total bigint;
begin
  m := coalesce(new.ai_musician_id, old.ai_musician_id);
  rt := coalesce(new.right_type, old.right_type);
  select coalesce(sum(ppm), 0) into total
  from rights.ai_musician_licensor_share
  where ai_musician_id = m and right_type = rt;
  -- A side may be entirely absent (0), but a present side must be exactly 100%.
  if total <> 0 and total <> 1000000 then
    raise exception 'ai_musician % % licensor shares sum to % ppm; must be exactly 1000000 (or the side absent)',
      m, rt, total;
  end if;
  return null;
end;
$$;

create constraint trigger licensor_share_sum_is_100_percent
  after insert or update or delete on rights.ai_musician_licensor_share
  deferrable initially deferred
  for each row execute function rights.check_licensor_share_sum();

-- Session telemetry on creations: note counts observed by the instrument.
alter table rights.creation
  add column human_notes bigint check (human_notes >= 0),
  add column ai_notes_kept bigint check (ai_notes_kept >= 0),
  add column ai_notes_edited bigint check (ai_notes_edited >= 0);

-- Per-ingredient telemetry + optional AI-musician provenance on recipe entries.
alter table rights.provenance_entry
  add column units_in_final_mix bigint check (units_in_final_mix >= 0),
  add column origin text check (origin in ('human_placed', 'ai_generated', 'ai_generated_edited')),
  add column ai_musician_id uuid references rights.ai_musician (id);

create index provenance_entry_ai_musician_idx
  on rights.provenance_entry (ai_musician_id) where ai_musician_id is not null;

alter table rights.ai_musician enable row level security;
alter table rights.ai_musician_licensor_share enable row level security;

-- NOTE (open-questions T6): licensor shares are a single current set, not yet
-- effective-dated versions like split_version. Must gain versioning before the
-- marketplace mutates them in production.
