#!/usr/bin/env bash
# Grants the `authenticated` role the same coarse table/function access PostgREST relies on on
# real Supabase (where these grants already exist by default) - RLS policies do the actual
# row-level restriction on top. Re-run after every migration that adds a table. Deliberately never
# grants DELETE broadly anywhere (CLAUDE.md #3: no user-facing hard delete) - the two narrow
# exceptions below exist only because a real RLS test needs to assert a DELETE is actually rejected
# by policy, not merely by an absent table grant.
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

-- Narrowly scoped, not a blanket "grant delete on all tables" - doing that once, while adding
-- M4.10's task_assignments immutability test, immediately broke several OTHER tables' own
-- already-passing "no hard delete" RLS tests elsewhere in this suite (tasks, documents,
-- notifications) - those tests assert a THROWN "permission denied" error, which stops being true
-- the moment DELETE is actually granted and RLS (correctly, with no delete policy) reduces the
-- statement to zero affected rows instead. Fixing every one of those tests' assertions to match the
-- more accurate privilege model real Supabase actually uses is real, valuable work, but it is its
-- own separate cleanup - so only the tables genuinely exercised by a "grant present, RLS/trigger
-- blocks it" style DELETE test get the grant: notification_preferences (M4.8), task_assignments
-- (M4.10, forbid_mutation() raises before RLS is ever reached), outcome_reasons/deal_outcomes
-- (M5.1/M5.2), contacts/deal_contacts (M5.5), activity_contacts (M5.7). Lives here, not in
-- db-bootstrap-local.sh, specifically because this script runs AFTER migrations (db-setup-local.sh's
-- own ordering) - every one of these tables is guaranteed to exist by the time this runs, unlike
-- bootstrap time on a genuinely fresh database.
grant delete on notification_preferences to authenticated;
grant delete on task_assignments to authenticated;
grant delete on outcome_reasons to authenticated;
grant delete on deal_outcomes to authenticated;
grant delete on contacts to authenticated;
grant delete on deal_contacts to authenticated;
grant delete on activity_contacts to authenticated;
SQL

echo "Granted authenticated role access on schema public/auth."
