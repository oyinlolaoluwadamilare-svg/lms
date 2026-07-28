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

echo "Ready: app_migrator (migrations/superuser), authenticated (RLS test role), database $DB_NAME."
