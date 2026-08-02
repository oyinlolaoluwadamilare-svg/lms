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
SQL

echo "Ready: app_migrator (migrations/superuser), authenticated (RLS test role), database $DB_NAME."
