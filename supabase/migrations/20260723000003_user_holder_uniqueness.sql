-- 0003 — One rights-holder row per game user.
--
-- The API creates a 'user'-kind rights_holder on demand the first time a user
-- appears. Two concurrent first-usages would otherwise create twin holders and
-- silently split that user's royalties across both. This partial unique index
-- makes the create-on-demand an idempotent upsert instead.
create unique index rights_holder_one_per_user
  on rights.rights_holder (user_id)
  where kind = 'user';

-- Statement queries filter by holder over a period; the existing
-- ledger_entry_holder_idx (holder_id, created_at) already covers that.
-- Provenance lookups join entries back to their assets:
create index provenance_entry_asset_idx on rights.provenance_entry (asset_id);

-- Split resolution is always "latest effective version for a subject as of T".
create index split_version_composition_idx
  on rights.split_version (work_id, effective_from desc, version desc)
  where right_type = 'composition';
create index split_version_master_idx
  on rights.split_version (recording_id, effective_from desc, version desc)
  where right_type = 'master';

-- Licenses are always fetched per asset.
create index license_asset_idx on rights.license (asset_id);
