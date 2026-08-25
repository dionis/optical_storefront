-- OPTIONAL fallback — only if you want the Supabase advisory badge to go green
-- while leaving the Data API switched on. `supabase-lockdown.sql` is the real
-- fix; this one only silences the linter's preferred signal.
--
-- Enables RLS, with zero policies, on every table in `public`. Zero policies
-- means "deny everything" to any role that is subject to RLS, which is exactly
-- what we want for anon/authenticated.
--
-- ⚠️ READ THIS BEFORE RUNNING ⚠️
-- This is only safe because the role in DATABASE_URL (`postgres`) OWNS these
-- tables, and Postgres table owners bypass RLS unless FORCE ROW LEVEL SECURITY
-- is set — which this script never sets. If DATABASE_URL is ever pointed at a
-- non-owner role, Medusa will start seeing empty tables and failing writes with
-- no obvious error. Do not run this if you plan to change that role.
--
-- ⚠️ It must be re-run after every `medusa db:migrate` that adds tables. That
-- recurring cost is the reason we prefer supabase-lockdown.sql.
--
-- Idempotent: skips tables that already have RLS on.

do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select c.oid::regclass as tbl
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relkind in ('r', 'p')   -- ordinary + partitioned tables
      and not c.relrowsecurity
    order by 1
  loop
    execute format('alter table %s enable row level security', r.tbl);
    n := n + 1;
  end loop;
  raise notice 'enabled RLS on % table(s)', n;
end $$;

-- Verify — must return zero rows:
--
--   select c.relname
--   from pg_class c
--   join pg_namespace ns on ns.oid = c.relnamespace
--   where ns.nspname = 'public' and c.relkind in ('r', 'p')
--     and not c.relrowsecurity;
