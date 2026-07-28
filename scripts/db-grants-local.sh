#!/usr/bin/env bash
# Grants the `authenticated` role the same coarse table/function access PostgREST relies on on
# real Supabase (where these grants already exist by default) - RLS policies do the actual
# row-level restriction on top. Re-run after every migration that adds a table. Deliberately never
# grants DELETE anywhere (CLAUDE.md #3: no user-facing hard delete).
set -euo pipefail

PSQL="${PSQL_SUPERUSER_CMD:-sudo -u postgres psql} -d ${DB_NAME:-pipeline_intelligence}"

$PSQL -v ON_ERROR_STOP=1 <<'SQL'
grant usage on schema public to authenticated;
grant usage on schema auth to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
grant execute on all functions in schema auth to authenticated;
alter default privileges in schema public grant select, insert, update on tables to authenticated;
alter default privileges in schema public grant execute on functions to authenticated;
SQL

echo "Granted authenticated role access on schema public/auth."
