-- 0002 — Pin search_path on the safeguard trigger functions.
-- An unpinned search_path lets a caller shadow the objects a function resolves,
-- a known privilege-escalation vector. These functions guard the money
-- invariants, so they must resolve their own schema deterministically.
-- (Raised as WARN function_search_path_mutable by the Supabase security linter.)
alter function rights.check_split_sum() set search_path = rights, pg_catalog;
alter function rights.forbid_mutation() set search_path = rights, pg_catalog;
