# Migrations

Sequential, numbered, reviewed pairs: `NNNN_name.up.sql` / `NNNN_name.down.sql`. Applied in order by
`db/migrate.mjs`, which tracks applied versions in a `schema_migrations` table it creates on first
run. Every migration must be reversible (CLAUDE.md, definition of done: "migration tested forward
and backward against seeded data") — a migration with no meaningful rollback still gets a `.down.sql`
that at least drops what it created.

Migrations are schema-only and portable to a real Supabase project as-is. They deliberately do
**not** create the `authenticated` Postgres role or the `auth` schema/`auth.uid()` function -
Supabase already provides both. For local development and CI, `scripts/db-bootstrap-local.sh`
creates a compatible local stand-in (see `tests/rls/fixtures/local_auth_shim.sql`); that stand-in
is never applied to a real Supabase database.

## Usage

```
DATABASE_URL=postgres://app_migrator:...@localhost:5432/pipeline_intelligence npm run db:migrate
DATABASE_URL=postgres://app_migrator:...@localhost:5432/pipeline_intelligence npm run db:migrate:down
```

`db:migrate` applies every not-yet-applied migration, in order, each inside its own transaction.
`db:migrate:down` rolls back exactly one migration (the most recently applied) - run it repeatedly
to unwind further.

## What exists so far

| Migration | Milestone | Contents |
|---|---|---|
| `0001_extensions_and_enums` | M0.2 | `uuid-ossp`, `citext`; the `user_status` and `app_role` enums |
| `0002_tenancy` | M0.2 | `tenants`, `practice_lines`, `users`, `user_roles` |
| `0003_rls_foundation` | M0.2 | `current_tenant_id`/`has_role`/`entitled_practices`/`can_write`; RLS on all four tables above |
| `0004_audit_log` | M0.6 | `audit_entries`; RLS (read-only for tenant_admin/executive/director, no write policy at all - service_role only); `forbid_mutation()` trigger blocking update/delete for every identity including the table owner |
| `0005_pipeline_stages_accounts_deals` | M1.1 | `pipeline_stages`, `accounts` + `account_practice_owners`, `deals` + `deal_co_owners`, all with RLS (db/schema.sql itself only enables RLS on deals/activities/tasks/stage_events/audit_entries - added here for the other three per CLAUDE.md #2); `active_deal_requires_owner_and_date`; `security definer` helper functions (`is_deal_co_owner`, `deal_tenant_id`, `deal_practice_line_id`, `deal_owner_id`, `deal_author_id`, `account_tenant_id`, `account_has_entitled_practice`) breaking the circular RLS dependency that adding RLS to `deal_co_owners`/`account_practice_owners` introduced (deals' and accounts' policies need those tables' data and vice versa - a raw cross-table `exists` in both directions is "infinite recursion detected in policy," caught by actually running the RLS suite, not by inspection) |
| `0006_updated_at_trigger` | M1.5 | `set_updated_at_and_by()` trigger on `deals`/`accounts` (the only two tables carrying both columns) - `changeStage`'s deal update was the first application write path against either table, which exposed that neither had ever had anything maintaining `updated_at`/`updated_by`. Sets `updated_by` from `auth.uid()`, never a caller-supplied value, the same protection `author_id` already has (migration 0005) |
| `0007_stage_events` | M2.1/M2.2 | `stage_events`; RLS (select-only for `authenticated`, scoped like `deals_select` via the `deal_tenant_id()`/`deal_practice_line_id()` helper functions - not db/schema.sql's own raw `exists (select 1 from deals ...)`, which would hit the same cross-table RLS recursion migration 0005 already found and fixed for `deal_co_owners`); `forbid_mutation()` reused as `trg_no_update_stage_events`; a `before insert` trigger computing `duration_in_previous_seconds` (previous `stage_events` row for the deal, or `deals.created_at` if there is none) and `is_regression` (`to_stage.sort_order < from_stage.sort_order`) transactionally, since a literal Postgres `generated` column - what docs/01-domain-model.md's spec implies - cannot reference another table's row. `src/services/deals.ts`'s `changeStage` now calls `src/services/stageEvents.ts`'s `writeStageEvent` on every successful move - the one real transition path that exists today; M2.2 names five more (form, API, bulk, mark-won, mark-lost) that don't exist yet in this codebase and so aren't wired to anything |

Every later migration that adds a tenant-scoped table ships RLS in the same migration - a table
without RLS does not ship (CLAUDE.md #2). `db/schema.sql` remains the full canonical reference this
directory is progressively implementing, per its own header comment - though it is not infallible:
it never enables RLS on `pipeline_stages`/`accounts`/`account_practice_owners`/`deal_co_owners` at
all, and its own `updated_by`-carrying-table list is incomplete against its own stated general rule
(`docs/01-domain-model.md`: "every mutable table carries created_at, updated_at, created_by,
updated_by"). Treat it as a strong starting point per table, not an unquestionable source for every
detail - CLAUDE.md's stated invariants are the higher authority when the two disagree.

## `0006_updated_at_trigger` and `0007_stage_events` are now applied to the real hosted project

Both were initially shipped verified only against the local test Postgres - this container has no
raw-TCP egress to the hosted project's database, so migrations before this point required a
Personal Access Token supplied ad hoc in chat (the same mechanism `0005` used) to run through the
Supabase Management API's SQL endpoint instead, and no such token was available in the session that
wrote `0006`/`0007`. That gap is now closed: a token was supplied in the M2.1/M2.2 session, both
migrations were applied to the hosted project the same way `0005` was (`schema_migrations` on the
real project now lists `0001` through `0007`), and `tests/integration/pipeline-list.spec.ts`'s
`changeStage` tests assert on `updated_at`/`updated_by` and on the `stage_events` row for real
against it, run three times consecutively to confirm the fixture's idempotency.

That same fixture fix is worth recording here: M2.1's `stage_events.deal_id` FK (no cascade) plus
`stage_events`' own immutability (`forbid_mutation` blocks delete for every role, including
service_role) means that once `changeStage` writes a `stage_events` row for a deal, that deal - and
transitively, the account/practice-line/stage rows it references - becomes permanently un-deletable
too, the same way `audit_entries` already pins the tenant/users (see
`tests/integration/support/permanentFixture.ts`). The fixture in `pipeline-list.spec.ts` was
delete-and-recreate for practice lines/stages/accounts/deals before this milestone; verified directly
that this silently broke on a second real run (Postgres rejects the whole multi-row `DELETE`
statement on the one FK-violating row, and supabase-js's `.delete()` resolves with an unchecked
`{error}` rather than throwing) - so it is now find-or-create for all four, with the advisory deal's
mutable fields reset to their original seed values on every run, and its audit/stage_events
assertions rewritten as before/after deltas rather than absolute counts (that history correctly
accumulates across real runs, per CLAUDE.md #4's append-only rule, rather than resetting).
