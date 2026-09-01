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
#
# The two DELETE grants this block used to also carry (notification_preferences, task_assignments -
# M4.8/M4.10's own DELETE-permission tests) were moved to scripts/db-grants-local.sh: this script
# runs BEFORE any migration has ever applied (db-setup-local.sh's own ordering), so `grant delete on
# notification_preferences` fails outright on a genuinely fresh database with "relation ... does not
# exist" - a bug that simply never surfaced before because every prior session reused an
# already-migrated local Postgres cluster rather than bootstrapping one from nothing. Confirmed
# directly against a clean container.
#
# Deliberately no DELETE in the default-privileges list below either (CLAUDE.md #3: no user-facing
# hard delete), even though an earlier version of this line included it - on a long-lived, reused
# local database that appeared harmless, since this ALTER only affects tables created AFTER it
# first runs, and most tables already existed from before it was added. On a genuinely fresh
# database, though, this statement runs before ANY table exists, so every migration-created table
# from that point on would get DELETE granted to `authenticated` by default - silently breaking
# tasks.spec.ts/documents.spec.ts/notifications.spec.ts's own "no hard-delete path" RLS tests
# (each asserts a thrown "permission denied", which stops being true the instant the grant exists
# and RLS, correctly, just reduces the statement to zero affected rows instead). Confirmed directly:
# a from-scratch db:setup:local with `delete` in this list failed exactly those three tests.
$PSQL -d "$DB_NAME" -v ON_ERROR_STOP=1 <<SQL
alter default privileges for role app_migrator in schema public
  grant select, insert, update on tables to authenticated;
alter default privileges for role app_migrator in schema public
  grant execute on functions to authenticated;
SQL

echo "Ready: app_migrator (migrations/superuser), authenticated (RLS test role), database $DB_NAME."
