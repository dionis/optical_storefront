-- Supabase hardening for the Medusa database.
--
-- Context: we use Supabase purely as managed Postgres. The backend connects
-- directly over DATABASE_URL (port 5432); nothing in this repo uses supabase-js
-- or the PostgREST Data API. But Supabase exposes the `public` schema through
-- PostgREST by default, and Medusa creates every one of its ~200 tables there —
-- including `prescription` (PHI), `customer`, `order_address`, `user` and
-- `auth_identity`. That is what the `rls_disabled_in_public` and
-- `sensitive_columns_exposed` advisories are reporting.
--
-- The dashboard toggle (Project Settings > Data API > disable) is the primary
-- fix. This script is the grant-level backstop underneath it: it survives
-- someone re-enabling the toggle later, and it keeps FUTURE Medusa migrations
-- from re-exposing themselves.
--
-- Run it in the Supabase SQL Editor (which connects as `postgres`, the role that
-- owns the Medusa tables). Idempotent — safe to re-run.
--
-- Roles deliberately untouched:
--   postgres / supabase_admin — own the schema; revoking would break migrations
--   authenticator             — the role PostgREST logs in as before SET ROLE;
--                               it needs to exist, it just must not reach `public`
--   service_role              — gated behind the secret service key, not published

begin;

-- ---------------------------------------------------------------------------
-- 1. Existing objects: take `public` away from the two web-facing roles.
--
--    NOTE — the schema-level revoke below is a NO-OP on this project, verified
--    against the live database. `public`'s ACL is:
--        pg_database_owner=UC/... | =U/... | postgres=U/... | service_role=U/...
--    The bare `=U/` entry is a grant to the PUBLIC pseudo-role (a Postgres 15
--    default), which is where anon and authenticated get USAGE from. You cannot
--    take that away with `revoke ... from anon`; it would need
--    `revoke usage on schema public from public`, which we do NOT do because it
--    reaches every role in the cluster.
--
--    That is fine: USAGE on a schema only allows resolving names inside it. With
--    zero privileges on the objects themselves — which the per-object revokes
--    below guarantee — there is nothing to resolve to. The object-level revokes
--    are what actually closes this, not the schema-level one.
-- ---------------------------------------------------------------------------
revoke usage on schema public from anon, authenticated;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Future objects. This is the part that actually keeps the advisory from
--    coming back: Supabase ships default privileges that auto-grant anon and
--    authenticated on anything new in `public`, so every `medusa db:migrate`
--    would otherwise re-expose its new tables.
--
--    ALTER DEFAULT PRIVILEGES is per-grantor, so it has to be repeated for each
--    role that creates objects here. `postgres` is the one Medusa migrates as.
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;

-- Same for supabase_admin, which seeds part of the schema. Wrapped because
-- ALTER DEFAULT PRIVILEGES FOR ROLE requires membership in that role, and the
-- SQL Editor's `postgres` is not a member of supabase_admin on newer projects.
-- Failing here is not a problem: supabase_admin does not create Medusa tables.
do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public '
          'revoke all on tables from anon, authenticated';
  execute 'alter default privileges for role supabase_admin in schema public '
          'revoke all on sequences from anon, authenticated';
  execute 'alter default privileges for role supabase_admin in schema public '
          'revoke all on functions from anon, authenticated';
exception when insufficient_privilege then
  raise notice 'skipped supabase_admin default privileges (not a member) — fine';
end $$;

-- Verified on this project: `postgres` is NOT a member of `supabase_admin`, so
-- the block above always takes the exception path and supabase_admin's default
-- privileges survive. They still read:
--     anon=arwdDxtm/supabase_admin | authenticated=arwdDxtm/supabase_admin
-- This is harmless here and cannot be changed from the SQL Editor. Default
-- privileges are keyed on the role that CREATES the object, and supabase_admin
-- does not create Medusa tables — `medusa db:migrate` runs as `postgres`, which
-- has no default ACLs left in `public`. Confirmed empirically by creating a
-- table as the migration role inside a rolled-back transaction: anon got no
-- privileges on it.

commit;

-- ---------------------------------------------------------------------------
-- 3. Verification. Both queries must return zero rows.
-- ---------------------------------------------------------------------------

-- 3a. No table in `public` reachable by anon/authenticated:
--
--   select table_schema, table_name, grantee, privilege_type
--   from information_schema.role_table_grants
--   where table_schema = 'public' and grantee in ('anon', 'authenticated');

-- 3b. No leftover default privilege re-granting them:
--
--   select pg_get_userbyid(defaclrole) as grantor, defaclacl
--   from pg_default_acl d
--   join pg_namespace n on n.oid = d.defaclnamespace
--   where n.nspname = 'public'
--     and array_to_string(defaclacl, ',') ~ '(anon|authenticated)=';
