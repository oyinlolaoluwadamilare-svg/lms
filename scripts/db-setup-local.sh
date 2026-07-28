#!/usr/bin/env bash
# One-shot local/CI setup: roles + database, migrations, the local auth shim, and grants.
# Safe to re-run. See db/migrations/README.md and tests/rls/README.md.
set -euo pipefail
cd "$(dirname "$0")/.."

DB_NAME="${DB_NAME:-pipeline_intelligence}"
MIGRATOR_URL="${MIGRATOR_DATABASE_URL:-postgres://app_migrator:migrator_local_dev@localhost:5432/${DB_NAME}}"

bash scripts/db-bootstrap-local.sh
# Applied before migrations: on real Supabase, auth.uid() already exists before any of our
# migrations run, so the local shim must be in place first too, for the same ordering.
${PSQL_SUPERUSER_CMD:-sudo -u postgres psql} -d "$DB_NAME" -v ON_ERROR_STOP=1 -f tests/rls/fixtures/local_auth_shim.sql
DATABASE_URL="$MIGRATOR_URL" node db/migrate.mjs up
bash scripts/db-grants-local.sh

echo "Local database ready: $DB_NAME"
