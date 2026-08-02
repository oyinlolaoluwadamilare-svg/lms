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
| `0008_activities` | M3.1 | `activities`, `activity_revisions` (the third table the backlog line names, `activity_contacts`, is deferred to M5.7 - its `contact_id` references `contacts(id)`, and `contacts` doesn't exist until M5.5); `activity_type`/`activity_source`/`disposition` enums; `is_client_facing` (a true Postgres `generated` column - unlike `stage_events.is_regression`, this only ever compares the same row's own `type`, so no trigger workaround is needed); `activity_date_not_future`/`retraction_needs_reason` check constraints; a `before insert` trigger capturing `stage_id_at_time` from the deal's current stage, authoritative regardless of what a caller passes (mirrors migration 0006/0007's trigger-is-authoritative pattern); RLS mirroring `deals_select`/`deals_update`'s scope shape via migration 0005's existing `deal_practice_line_id()`/`deal_owner_id()`/`deal_author_id()`/`is_deal_co_owner()` helpers, with `activity.update` uniformly "the author only, within 24h" for every role including `tenant_admin` (correcting someone else's entry is `activity.retract`, a materially broader permission deliberately NOT granted by this policy - flagged as M3.6's job, the same "RLS is coarse, `can()`/a dedicated service path is where the fine-grained rule lives" reasoning `tests/rls/deals_permission_matrix.spec.ts` already documents for `deal.change_owner`) |
| `0009_activity_engagement_trigger` | M3.2 | `refresh_deal_engagement()` + `trg_activity_refresh` (`after insert or update on activities`) - the `last_engaged_at`/`last_engaged_activity_id`/`engagement_count` derived-field maintenance docs/07-build-backlog.md names as M3.2's own deliverable, deliberately left out of migration 0008. Matches `db/schema.sql`'s reference implementation verbatim; `security definer` so the update to `deals` succeeds regardless of which role's session fired the triggering insert |
| `0010_documents` | M3.8 | `documents` (`docs/01-domain-model.md`'s field list, minus `contact_id` - deferred like `activity_contacts`, `contacts` doesn't exist until M5.5 - and minus `version_number`/`supersedes_document_id`, explicitly M9.5's own deliverable); `document_type` enum; provisions the private "documents" Supabase Storage bucket in the same migration (`insert into storage.buckets` - buckets are plain rows, documented Supabase behaviour); a `before insert` trigger capturing `practice_line_id` from `deal_id` (mirrors `stage_id_at_time`'s own pattern); RLS: `documents_select` "inherits deal visibility" via `deal_practice_line_id()` (identical shape to `activities_select`), `documents_insert` mirrors `activity.attach_file`'s own/practice/tenant scope (identical to `activity.create`'s). **No RLS policy on `storage.objects`** - every access is mediated by a caller's own RLS-scoped read of `documents` first, then a service-role Storage call, never storage.objects RLS duplicating the same check a second way. **No UPDATE policy at all** - `document.soft_delete` is out of scope for M3.8 (upload plus view, not removal) and, a genuine finding worth not rediscovering later, Postgres re-validates an `UPDATE`'s resulting row against a table's own SELECT policy too: since `documents_select` requires `deleted_at is null`, no UPDATE policy setting `deleted_at` could ever succeed through a caller's own session anyway - a future soft-delete needs a service-role-backed write, `retractActivityRow`-style, not RLS. Local Postgres has no `storage` schema at all, so `tests/rls/fixtures/local_auth_shim.sql` gained a minimal `storage.buckets` shim table for this one migration's insert to target |

| `0011_tasks` | M4.1 | `tasks`, `task_assignments` ("the immutable reassignment ledger" - domain model), `task_comments`, `task_watchers`; `task_status`/`task_priority` enums; the `blocked_needs_reason`/`done_needs_completion` check constraints this milestone's own backlog line names. Deviations from `db/schema.sql`: `contact_id` deferred (`contacts` doesn't exist until M5.5, same reasoning as `activity_contacts`/`documents.contact_id`); the `next_action_task_id`/`next_action_due_date` derivation trigger (`refresh_deal_next_action()`) deferred to **M4.4**, its own named deliverable - the identical M3.1/M3.2 structure-then-trigger split; `updated_by` added to `tasks` (`db/schema.sql` omits it, the same gap migration 0005 already found and fixed for `accounts`/`deals`); RLS substitutes `deal_practice_line_id()`/`deal_owner_id()`/`deal_author_id()`/`is_deal_co_owner()` for `db/schema.sql`'s own raw `exists (select 1 from deals ...)` joins, the same cross-table-RLS-recursion-avoidance migrations 0007/0008/0010 already established; four new helper functions (`task_tenant_id`/`task_deal_id`/`task_assignee_id`/`task_assigned_by`) resolve `task_assignments`/`task_comments`/`task_watchers`' own policies through the parent `tasks` row, since none of the three carry a `tenant_id` column of their own (the same shape `deal_co_owners` already established via `deal_tenant_id()`/`deal_practice_line_id()`). **A genuine, direct doc conflict, resolved by explicit user decision**: `docs/01-domain-model.md` says `tasks.due_date` is NOT NULL; `docs/06-ui-spec.md`'s My Work screen names a "No date" grouping bucket, which only makes sense if some tasks lack a due date. Decided: NOT NULL, following the domain model - the "No date" bucket (M4.5) will simply always be empty in this codebase for now. Two further scope decisions deferred rather than guessed: `task_comments.resolved_at`/`resolved_by`'s mutation path (who may resolve a comment) is undocumented anywhere and named by no M4 backlog line, so no UPDATE policy exists yet for `authenticated` (deliberately not `forbid_mutation()` either - unlike `task_assignments`, this isn't meant to be permanently immutable, just not-yet-built); and `snooze_count`'s companion reason text (M4.5's own "snooze with reason after two snoozes") has no documented column anywhere, so none is added here - that decision belongs to the milestone that actually builds snoozing. `task_watchers` gets a SELECT policy only - no "add watcher" action exists in the permission matrix yet (the same "not invented here" reasoning migration 0005's `deal_co_owners_insert` comment already gives for the analogous gap) |

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

`0008_activities` and `0009_activity_engagement_trigger` were both applied to the hosted project the
same way, in the sessions they were written - `schema_migrations` there now lists `0001` through
`0009`. `tests/integration/log-activity.spec.ts` (M3.2) exercises `0009`'s trigger for real against
the hosted project, run twice consecutively to confirm the fixture's idempotency; `0008` itself is
covered by `tests/rls/activities.spec.ts` against local Postgres only (no real-project integration
spec existed for it in isolation, since nothing called `logActivity` yet at the time it was
written).

`0010_documents` was applied to the hosted project the same way, and forward/backward-tested for
real in the process: applying it once surfaced that its original `documents_soft_delete` UPDATE
policy could never actually be satisfied (the SELECT-policy-re-validates-the-new-row finding this
table's own README entry above describes), so the migration was rolled back, corrected to remove
that policy entirely, and re-applied - `schema_migrations` on the real project now lists `0001`
through `0010`, and the private "documents" Storage bucket exists there for real too. One real,
disclosed limitation found rolling back on the hosted project specifically (not reproduced by the
local shim): Supabase blocks a direct SQL `DELETE` against `storage.buckets`
("Direct deletion from storage tables is not allowed. Use the Storage API instead." -
`storage.protect_delete()`), so `0010_documents.down.sql` does not attempt to delete the bucket row
- rolling back leaves an empty, harmless, unused bucket in place; a full teardown would need the
Storage API or dashboard. `tests/integration/attach-document.spec.ts` (M3.8) exercises the real
upload/download/permission chain against the hosted project, run twice consecutively to confirm
fixture idempotency.

`0011_tasks` was applied to the hosted project the same way - forward/backward-tested locally first
(rolled back and re-applied cleanly, no surprises this time), then applied for real;
`schema_migrations` there now lists `0001` through `0011`. Schema-only milestone (no service or UI
layer exists yet - that's M4.2+), so `tests/rls/tasks.spec.ts` (34 tests, against local Postgres) is
the primary verification, the same shape every earlier schema-only migration in this repo
(`0002_tenancy`/`0003_rls_foundation`, `0007_stage_events` before M2.2's `changeStage` wiring) used
before its own service layer existed to exercise against the real hosted project.
