#!/usr/bin/env bash
# Creates the local Postgres roles and database used for dev + the RLS test harness.
# Idempotent. Never run against a real Supabase project - Supabase already provides
# equivalent roles (postgres/service_role, authenticated) and its own auth schema.
set -euo pipefail

PSQL="${PSQL_SUPERUSER_CMD:-sudo -u postgres psql}"
DB_NAME="${DB_NAME:-pipeline_intelligence}"

$PSQL -v ON_ERROR_STOP=1 <<SQL
do \$\$
begin
  if not exists (select from pg_roles where rolname = 'app_migrator') then
    create role app_migrator with login password 'migrator_local_dev' superuser;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated with login password 'authenticated_local_dev' nosuperuser;
  end if;
end
\$\$;

select 'CREATE DATABASE $DB_NAME'
where not exists (select from pg_database where datname = '$DB_NAME')
\gexec
SQL

# On a real Supabase project, `authenticated` (and `anon`/`service_role`) already carry full
# table/function privileges out of the box - RLS, not the table-level grant, is what actually
# restricts access there (verified directly: querying information_schema.role_table_grants against
# the real hosted project shows `authenticated` already holds select/insert/update/delete on every
# table). Every migration in db/migrations/ relies on that being true and so never contains a GRANT
# statement itself (db/migrations/README.md's own "portable to a real Supabase project as-is"). This
# local stand-in needs the equivalent, scoped to whichever role actually runs migrations locally
# (app_migrator, not postgres) - `alter default privileges FOR ROLE app_migrator` only affects
# objects that role creates AFTER this runs, so it must be (re-)run here, in this idempotent
# bootstrap script, not left as a one-off manual step future migrations would silently depend on.
$PSQL -d "$DB_NAME" -v ON_ERROR_STOP=1 <<SQL
alter default privileges for role app_migrator in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges for role app_migrator in schema public
  grant execute on functions to authenticated;

-- Retroactive, narrowly scoped - the default-privileges rule above only affects tables
-- app_migrator creates AFTER this script runs, so tables that already existed before this fix
-- still have whatever the original, pre-this-fix one-off GRANT gave them. That original grant
-- turned out to never have included DELETE, on ANY table (confirmed directly: every pre-existing
-- table has select/insert/update but not delete for `authenticated`) - a real, disclosed
-- local/production divergence, since the real hosted project DOES grant DELETE broadly, with RLS
-- alone doing the restricting there. Deliberately NOT fixed with a single blanket
-- "grant delete on all tables in schema public" here: doing that once, while adding M4.10's
-- task_assignments immutability test, immediately broke several OTHER tables' own already-passing
-- "no hard delete" RLS tests elsewhere in this suite - those tests assert a THROWN
-- "permission denied" error, which stops being true the moment DELETE is actually granted and RLS
-- (correctly, with no delete policy) reduces the statement to zero affected rows instead. Fixing
-- every one of those tests' assertions to match the more accurate privilege model is real,
-- valuable work, but it is its own separate cleanup, out of scope for this milestone - so only the
-- two tables genuinely exercised by a real DELETE-permission test today get the grant:
-- notification_preferences (M4.8) and task_assignments (M4.10).
grant delete on notification_preferences to authenticated;
grant delete on task_assignments to authenticated;
SQL

echo "Ready: app_migrator (migrations/superuser), authenticated (RLS test role), database $DB_NAME."
