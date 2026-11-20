-- Read-only role for scripts/db-compare/compare.mjs.
--
-- Run it in the Supabase SQL editor of EACH project (production and staging),
-- after replacing the password. The role can SELECT and nothing else; every
-- transaction it opens is read-only even if a query tried to write.
--
-- Connection string through the pooler (Supavisor needs the project ref in the
-- user name):
--   postgresql://db_compare_ro.<PROJECT_REF>:<PASSWORD>@<POOLER_HOST>:5432/postgres
-- URL-encode the password if it has symbols (@ : / ? # %).

create role db_compare_ro with login password 'CAMBIAR-POR-UNA-CONTRASEÑA-LARGA';
alter role db_compare_ro set default_transaction_read_only = on;
alter role db_compare_ro set statement_timeout = '30s';
alter role db_compare_ro set idle_in_transaction_session_timeout = '60s';

grant usage on schema public to db_compare_ro;
grant select on all tables in schema public to db_compare_ro;
grant select on all sequences in schema public to db_compare_ro;

-- Check (should say "on"):
--   set role db_compare_ro; show default_transaction_read_only; reset role;

-- When the comparison is done, remove it:
--   drop owned by db_compare_ro;
--   drop role db_compare_ro;
