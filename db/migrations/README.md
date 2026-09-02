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

`0012_notifications` was applied to the hosted project the same way - forward/backward-tested
locally first, then applied for real; `schema_migrations` there now lists `0001` through `0012`.
Authored from scratch, unlike `0011_tasks`: `db/schema.sql` has no `notifications` table at all to
diff against, so its RLS shape (recipient-only, no `tenant_admin`/`executive` tenant-wide override,
no insert policy for `authenticated`) is this migration's own design, reasoned from
`docs/01-domain-model.md` and this codebase's `audit_entries` precedent rather than found as a gap
in a reference implementation. `tests/rls/notifications.spec.ts` (8 tests, against local Postgres)
covers it directly; `tests/integration/assign-task.spec.ts` (M4.2, 8 tests, against the real hosted
project) exercises the real insert path end to end via `assignTask`'s service-role write.

`0013_next_action_trigger` was applied to the hosted project the same way - forward/backward-tested
locally first (including a manual SQL walkthrough of insert/complete/complete-the-last-one, to prove
the bug fix below before ever touching the real project), then applied for real; `schema_migrations`
there now lists `0001` through `0013`. Adds the FK `deals.next_action_task_id` → `tasks(id)` that
migration 0005 deferred (tasks didn't exist yet), and `refresh_deal_next_action()` +
`trg_task_refresh`, both deliberately deferred out of migration 0011 (that migration's own header
comment named this exact split).

**A genuine bug in `db/schema.sql`'s own reference trigger**, found by reasoning through it rather
than porting it verbatim: its `refresh_deal_next_action()` does
`update deals d set ... from (select ... limit 1) sub where d.id = ...` - an `UPDATE ... FROM
(subquery)` only touches rows where the subquery contributes at least one row. When a deal's LAST
open task closes (done/cancelled/soft-deleted), that subquery returns zero rows, so the UPDATE
touches zero rows - `next_action_task_id`/`next_action_due_date` would be left pointing at the
now-closed task forever, never clearing back to null. Confirmed directly against local Postgres
before writing the fix (a manual `insert → complete → complete-the-last-remaining-one` walkthrough
reproduced the stale reference exactly as predicted). Fixed with an explicit `if not found` branch
that clears both columns when no open task remains - `tests/integration/next-action.spec.ts` (M4.4,
5 tests, against the real hosted project, run twice consecutively) exercises exactly this sequence
through the real `createTask` service and `getDealDetail`'s own `nextAction` field, with its final
test asserting the previously-stale case specifically.

`0014_notification_preferences` was applied to the hosted project the same way - forward/backward-
tested locally first, then applied for real; `schema_migrations` there now lists `0001` through
`0014`. Adds `notification_preferences` (per-user, per-event-type, default-on when no row exists)
and `sweep_overdue_tasks()`, the first background job in this codebase, scheduled via `pg_cron`
(`CLAUDE.md`'s stated "Supabase cron plus a job table" architecture) rather than a bespoke job-queue
table - the notifications table's own `(entity_id, event_type)` pair already is the idempotency
ledger this job needs (backed by a partial unique index, `notifications_task_overdue_once`), and the
sweep is one atomic `insert ... select ...` statement, not a multi-step process that could fail
partway. Three decisions with no doc to point to were made by explicit user choice rather than
guessed: `task_overdue` fires once per task (not a repeating daily nag); the sweep runs on a real
`pg_cron` schedule (every 15 minutes, a judgment call) rather than staying a callable-only function
with scheduling deferred; and `mentioned` is added to the preference set now, even though nothing
can fire it until M4.9 wires up comment creation. The sweep's own status filter is `('open',
'in_progress')`, deliberately excluding `'blocked'` - matching migration 0011's own pre-built
`tasks_overdue` partial index exactly; `src/domain/task.ts`'s `taskQueueGroup` has no such carve-out
(a blocked, past-due task still visually sits in My Work's "Overdue" bucket), a disclosed, deliberate
divergence between that UI grouping and this proactive notification, not a bug.

This sandbox has no raw-TCP egress to the hosted project's Postgres instance (same constraint
`0006`/`0007` first hit) - this migration was applied via the Supabase Management API's SQL query
endpoint instead, using a Personal Access Token supplied ad hoc in chat, the same mechanism used for
every migration through `0013`.

A genuine, disclosed local-test-harness gap was found and fixed while building this migration, not
papered over: local Postgres's `authenticated` role privileges on every table through `0013` came
from a manual, undocumented, one-off `GRANT` issued at some point in this repo's history - never
from the versioned migrations themselves (confirmed: zero `GRANT` statements exist anywhere in
`db/migrations/`), and never from a default-privileges rule scoped to the role migrations actually
run as locally (`app_migrator`). The real hosted project needs no such thing - `authenticated`
already carries full table/function privileges by default there, verified directly via
`information_schema.role_table_grants`, with RLS alone doing the restricting - so this table simply
never inherited any grant at all until `scripts/db-bootstrap-local.sh` was fixed to run `alter
default privileges for role app_migrator ... grant ... to authenticated` (mirroring real Supabase's
own behaviour, for every future table, not just this one) and the same grant was applied
retroactively to this migration's own already-created table/function. One consequence worth
flagging: `tests/rls/notifications.spec.ts`'s own "no hard-delete" test asserts a thrown `/permission
denied/` error, which only holds because `notifications`' own local grant happens to omit `DELETE`
entirely - not a faithful mirror of the real project (which does grant `DELETE`, relying purely on
RLS to reduce it to zero affected rows). `tests/rls/notificationPreferences.spec.ts`'s own equivalent
test asserts the latter, correct behaviour instead; the older test was not "fixed" to match, since
that was out of scope for this migration, but the divergence is called out in both files' own
comments rather than silently left for a future session to rediscover.

`tests/rls/notificationPreferences.spec.ts` (10 tests, against local Postgres) covers the RLS shape
directly; `tests/integration/notification-preferences.spec.ts` (8 tests, against the real hosted
project) proves the preference gate (`src/services/notifications.ts`'s `sendNotification`) actually
suppresses and resumes a notification through the real `createTask`/`assignTask` services, and calls
`sweep_overdue_tasks()` via RPC exactly as `pg_cron` invokes it in production - confirming it fires
once, respects the per-user opt-out, and never double-fires on a repeat sweep. `createTask`'s and
`assignTask`'s own pre-existing integration tests were re-run and confirmed unaffected, proving the
new gate's default-on behaviour doesn't disturb either notification path when no preference row
exists.

`0015_task_watchers_and_comment_resolution` was applied to the hosted project the same way -
forward/backward-tested locally first, then applied for real via the Management API (same
no-raw-TCP-egress constraint as every migration since `0006`); `schema_migrations` there now lists
`0001` through `0015`. Fills the two gaps migration 0011 deliberately left open and named explicitly
as this milestone's own job: `task_watchers_insert` (mirrors `task_comments_insert`'s "visible"
shape, minus the author-only restriction - RLS permits adding ANY in-scope-visible user as a
watcher, the fine-grained "is this specific other user actually in scope" check living in
`src/services/taskComments.ts`, the same split `createTask`'s own assignee re-check already
established) and `task_comments_resolve` (scoped like `tasks_update`, not comment authorship -
narrower than `task_comments_select`/`_insert`, which still include `executive`; resolving is
denied for `executive` entirely).

Three business-rule decisions with nothing in `docs/` to point to were made by explicit user choice,
not guessed, and are recorded in `docs/02-permission-matrix.md`'s own new footnote 4: watchers are
BOTH automatic (a task's assignee and assigner become watchers from creation, reassignment adds the
new assignee, an @mention adds the mentioned user) AND manual (`task.watch` self-add,
`task.add_watcher` add-someone-else); comment resolution is built now rather than deferred further,
reusing the `resolved_at`/`resolved_by` columns migration 0011 already added but left unwired; there
is still no "remove watcher"/"unwatch" action - not named by this milestone, the same "not invented
here" reasoning migration 0005's `deal_co_owners_insert` comment already gave for the analogous
`deal.remove_co_owner` gap. @mention itself is implemented as picking from the same in-scope
picker population the assignee picker already uses (`listAssignableUsersForPractice`/`Tenant`), not
by parsing `@handle` syntax out of free-text comment bodies - `src/services/taskComments.ts`'s own
header comment has the full reasoning for why a picker satisfies "an in-scope user picker" literally
rather than needing an invented markup format.

Three new permission actions were added to `docs/02-permission-matrix.md` and
`src/auth/permissions.ts` for the first time: `task.watch` (mirrors `task.comment`'s "visible"
scope), `task.add_watcher` and `task.mention_user`'s own shape (both "pick another in-scope user",
`practice`/`tenant`), and `task.resolve_comment` (mirrors `task.update`'s `assigned_by`/`assigned`
scope). `tests/permissions/matrix.spec.ts` gained named positive/negative cases for all three, per
CLAUDE.md's own permission-test rule.

`tests/rls/tasks.spec.ts`'s own `task_watchers` describe block - previously pinning "no
`authenticated` identity can add themselves as a watcher yet" as the correct M4.1-era behaviour - was
rewritten to prove the new M4.9 behaviour instead (self-add, add-someone-else via practice
visibility, cross-practice rejection, impersonation rejection via `added_by`), plus a new
`task_comments_resolve` describe block. `tests/integration/task-comments.spec.ts` (12 tests, against
the real hosted project) proves `createTask`'s own new auto-watch behaviour, `createTaskComment`'s
@mention → watcher + notification side effects (including the self-mention-skips-notification and
invalid-mention-is-rejected cases), `addWatcher`'s self/other paths, and `resolveTaskComment`'s
task-state-not-authorship scoping (including the executive-denied-at-can()-level case) - all run
against real signed-in sessions, not a service-role client.

`0016_outcome_reasons_and_deal_outcomes` (M5.1, the first migration of Milestone 5) was applied to
the hosted project the same way - forward/backward-tested locally first, then applied for real via
the Management API (same no-raw-TCP-egress constraint as every migration since `0006`);
`schema_migrations` there now lists `0001` through `0016`. `db/schema.sql` has reference
definitions for both tables (lines 108-115, 360-374), with real gaps this migration closes rather
than reproduces verbatim, the same discipline migration 0005 established for accounts/deals:
`outcome_reasons.type` becomes a proper `outcome_type` enum (schema.sql left it a bare
`text check`, unlike every comparable closed-set column elsewhere in this schema);
`outcome_reasons` gains `created_at`/`updated_at`/`created_by`/`updated_by` (schema.sql omits them
entirely, unlike its own `pipeline_stages` sibling); a `unique (tenant_id, type, label)` constraint
is added (schema.sql has no uniqueness constraint on this table at all); and
`deal_outcomes` gains a `final_value_needs_currency` check (both null or both set, never
half-populated) alongside schema.sql's own `loss_requires_detail` check, which is kept verbatim.

Two decisions were deliberately NOT made in this migration, left to the milestones that actually
need them: nothing gives `outcome_reasons` a structural flag for "this loss reason means
lost-to-competitor" - M5.2's own backlog line ("lost-to-competitor requires a name") is what will
decide how a reason is recognised as competitor-shaped; and `deal_outcomes` gets SELECT/INSERT
policies only, no UPDATE/DELETE - `deal_id` is its own primary key (one outcome per deal, ever), and
no doc or backlog line through M5.4 names a "revise a recorded outcome" action, the same
"task_comments.resolved_at had no UPDATE policy until M4.9 specifically named the scope" precedent
migrations 0011/0015 already established.

RLS mirrors two existing tables exactly rather than inventing new shapes: `outcome_reasons` mirrors
`pipeline_stages` (tenant-wide select, tenant_admin-only insert/update, no delete - deactivate via
`is_active`); `deal_outcomes` mirrors `deals_select`/`deals_update` exactly (via the existing
`deal_tenant_id()`/`deal_practice_line_id()`/`deal_owner_id()`/`deal_author_id()`/
`is_deal_co_owner()` security-definer helpers from migration 0005) per
`deal.mark_won`/`deal.mark_lost` sharing `deal.update`'s own own/practice/-/tenant scope in
docs/02-permission-matrix.md. `admin.manage_outcome_reasons` itself needed no changes to
`src/auth/permissions.ts` - it was already correctly wired (`tenant` for tenant_admin, denied
elsewhere) from early scaffolding, just never called by anything until now; it gained its first
named test case in `tests/permissions/matrix.spec.ts` all the same, since nothing had one before.

A second local-only grant gap was found and fixed the same way M4.8's own DELETE-grant gap was:
adding a real DELETE-permission test (this time for `task_assignments`' own immutability, closing
M4.10's "reassignment history is never overwritten" exit criterion) revealed that literally every
pre-existing local table was missing DELETE for `authenticated` (the real hosted project grants it
broadly on all of them, confirmed directly). Deliberately NOT fixed with one blanket
`grant delete on all tables in schema public` - doing that once immediately broke several OTHER
tables' own already-passing "no hard delete" RLS tests elsewhere in the suite, which assert a
THROWN "permission denied" error, an assumption that stops being true the moment DELETE is actually
granted and RLS (correctly, with no delete policy) reduces the statement to zero affected rows
instead. `scripts/db-bootstrap-local.sh` now grants DELETE narrowly, on only the two tables a real
test actually exercises today (`notification_preferences`, `task_assignments`) - fixing every other
table's own test assertions to match the more accurate privilege model is real, valuable work, left
as its own separate, disclosed cleanup rather than an unplanned tangent here.

`tests/rls/outcomeReasonsAndDealOutcomes.spec.ts` (17 tests, against local Postgres) covers both
tables' RLS shape and both check constraints directly; `tests/integration/outcome-reasons.spec.ts`
(4 tests, against the real hosted project) proves the admin service end to end through real
signed-in sessions - a tenant_admin can list/create/(de)activate reasons, a bde is denied at the
can() level for all three even though outcome_reasons_select's own RLS would let them read the
table directly (the admin SCREEN's narrower scope is the service's own explicit can() check, not
RLS alone), and the duplicate-label constraint is exercised for real. The admin UI itself
(`app/(app)/admin/outcome-reasons/`) is this codebase's first admin CRUD screen - manual browser QA
confirmed create, deactivate and reactivate all work end to end against the real hosted project.

`0017_close_deal` (M5.2: "`closeDeal` service: atomic outcome, stage event, status, open-task
cancellation, audit. Closing is impossible without a reason; loss requires detail; lost-to-
competitor requires a name.") resolves both decisions migration 0016 explicitly deferred, and is the
first migration in this codebase to introduce a genuinely atomic multi-table write.

**Decision 1 - how a reason is recognised as competitor-shaped.** A new `requires_competitor_name
boolean not null default false` column on `outcome_reasons`, tenant-admin-settable per reason (the
existing admin screen gained a checkbox for it, shown only when editing a loss-type reason), guarded
by a `requires_competitor_name_only_for_loss` check constraint so the flag is meaningless for a win
reason. Rejected: matching a reserved/magic label string (fragile - labels are free-text and
tenant-editable, migration 0016's own `unique (tenant_id, type, label)` constraint already treats
them as such) and unconditionally requiring a competitor name whenever `result = 'loss'` (wrong -
not every loss is to a competitor; docs/07-build-backlog.md's M5.4 "loss-reason report by ...
competitor" only makes sense as a real reporting dimension if competitor genuinely can be absent).

**Decision 2 - atomicity.** docs/03-architecture.md is explicit, not merely aspirational, here:
"Every state change is a transaction that includes its audit entry. If the audit write fails, the
business write rolls back." Every compound write built through M5.1 (`createDeal`, `changeStage`)
instead used sequential Supabase-client calls with an explicitly disclosed non-atomicity gap -
`src/services/audit.ts`, `src/services/stageEvents.ts` and `changeStage`'s own comment all named the
same fix ("a single Postgres function invoked through one `.rpc()` call") without building it.
`closeDeal` touches four tables (`deals`, `stage_events`, `deal_outcomes`, `tasks`) plus
`audit_entries` in one write - the highest-risk compound write yet, where a partial failure means a
deal silently looks won with no outcome record, or vice versa - so this migration finally pays that
debt down: `close_deal` is a single `security definer` plpgsql function, invoked from
`src/services/deals.ts`'s `closeDeal` through one `.rpc()` call, wrapping the deal status/stage
update, the `stage_events` insert, the `deal_outcomes` insert, open-task cancellation (`status in
('open','in_progress','blocked')`, unqualified by who assigned the task - `docs/01-domain-model.md`:
"Closing a deal cancels remaining open tasks", not "tasks you assigned") and the `audit_entries`
insert in one real Postgres transaction. This is the first genuinely atomic compound write in this
codebase.

Trust boundary, consistent with every other privileged write here (`writeStageEvent`, `writeAudit`,
`sweep_overdue_tasks` - none independently re-verify role-scope authorisation inside the privileged
write itself): `close_deal` does NOT re-implement `deal.mark_won`/`deal.mark_lost`'s own
own/practice/tenant scope check - `src/services/deals.ts`'s `closeDeal` already calls `can()` before
ever invoking the function, the same "TS `can()` is the real gate, the privileged write trusts it"
split used since M2.1. What the function DOES check independently, as a non-bypassable backstop: the
deal exists and belongs to the given tenant, the chosen reason belongs to the same tenant and
matches the result type, and the competitor-name/loss-detail rules (the TS caller validates all of
these too, for a clean result code instead of a raw exception). `forecast_category` is deliberately
left untouched - nothing in the backlog or existing code auto-derives it. `auth.uid()` is used
directly for every actor/author column, never a caller-supplied parameter, unaffected by running
inside a `security definer` function (it reads the session-level JWT claim GUC, not the function
owner's identity) - the same impersonation-proofing every actor_id/author_id column in this schema
already relies on.

Applied to the real hosted project via the Management API, same as every migration since `0006`;
`schema_migrations` there now lists `0001` through `0017`. Verified locally first, including a real
bug the manual verification pass caught before the hosted apply: the target-stage lookup's `case
p_result when 'win' then 'won' else 'lost' end` compared directly against a `stage_type` column with
no cast, so Postgres inferred the case expression as `text` and the comparison failed outright -
fixed with an explicit `::stage_type` cast, then re-verified with the same manual SQL walkthrough
(win close, loss close with detail, three independently rejected paths - missing detail, missing
competitor name, reason/result type mismatch - each proven to leave every one of the four tables
untouched, and a re-close of an already-won deal failing on `deal_outcomes`' own primary key rather
than silently succeeding).

`tests/rls/closeDeal.spec.ts` (9 tests, against local Postgres) exercises `close_deal` directly
through real `authenticated` sessions (not the superuser migrator client), proving the atomicity and
rejection paths above plus a deliberate trust-boundary case: a session with no business relationship
to a specific deal can still call `close_deal` on it directly and succeed, since the function does
not re-check `deal.mark_won`/`deal.mark_lost`'s own scope - documenting why `closeDeal` (the TS
service) must never be bypassed, not treating it as a gap. `tests/integration/close-deal.spec.ts` (8
tests, against the real hosted project, real signed-in sessions) proves `closeDeal`'s own TS-layer
pre-validation end to end: a bde closing their own deal as won or lost, an executive denied before
any write, and clean result codes (not raw exceptions) for already-closed, reason-type-mismatch,
missing-loss-detail and missing-competitor-name. No new UI - `src/services/deals.ts`'s `closeDeal`
is the whole of M5.2; the Mark Won/Mark Lost dialogs are M5.3's job.

`0018_contacts_and_deal_contacts` (M5.5: "`contacts`, `deal_contacts` migrations; primary-contact
invariant.") reproduces `db/schema.sql`'s own reference definitions for both tables (lines 148-163,
220-229) - including its `decision_role` enum and its `one_primary_contact` partial unique index,
the same idiom `pipeline_stages`' own `one_won_stage`/`one_lost_stage` indexes already established -
with the same deviations-from-the-reference-kit discipline migrations 0005/0016 already set: `contacts`
gains `updated_at`/`updated_by`/`created_by` (schema.sql had only `created_at`) and both tables gain
RLS (schema.sql enabled it on neither) - CLAUDE.md #2 and docs/01-domain-model.md's opening rule win
over the reference kit, as always. `deal_contacts` gets SELECT and INSERT policies only, no
UPDATE/DELETE - the identical reasoning migration 0016 gave for `deal_outcomes` ("no doc or backlog
line names a 'revise a recorded outcome' action"): `contact.link_to_deal` in docs/02-permission-
matrix.md is insert-shaped, and no unlink/reassign-primary/revise-decision-role action exists
anywhere yet. Not invented here - left for whichever future milestone (M5.6, plausibly) actually
names that action.

**The primary-contact invariant, precisely.** docs/01-domain-model.md's own wording is "exactly one
`is_primary = true` per deal when any contact exists" - the partial unique index alone only
guarantees "at most one," not "at least one once contacts exist." Because `deal_contacts` is
insert-only (previous paragraph - no update path exists to promote a later contact to primary), the
only moment this half of the invariant can be established or broken is a deal's very first insert: a
new trigger function, `validate_deal_contact()`, rejects an attempt to insert a deal's first contact
with `is_primary = false` - a non-bypassable DB-level backstop behind `src/services/contacts.ts`'s
own friendlier default (`linkContactToDeal` decides `isPrimary` itself, true for a deal's first
contact and false otherwise; a caller has no way to ask for anything else). The same trigger also
enforces an invariant `docs/01-domain-model.md` states explicitly for the structurally identical
`deal_co_owners` ("co-owner must belong to the deal's practice line") but never says outright for
`deal_contacts`: a linked contact must belong to the same account as the deal. Treated as the same
class of obvious-but-unstated structural requirement, not a business-rule ambiguity worth
escalating - no reading of "stakeholder" in `docs/06-ui-spec.md`'s own Stakeholders section supports
attributing a deal to a contact from a completely unrelated client.

**A real bug the manual local verification pass caught before the hosted apply**, the same payoff
migration 0017's own verification found: `validate_deal_contact()` was first written as a plain
(invoker-rights) function, the same shape `stage_events_before_insert()`/`set_updated_at_and_by()`
already use correctly for their own purposes. That shape was wrong here specifically - the
function's own internal reads (the deal's account, the contact's account, the deal's current contact
count) were themselves subject to the CALLING actor's own RLS visibility, so a caller outside the
deal's practice (whom `deal_contacts_select` already hides every existing row from) saw a false
"zero existing contacts" and tripped the wrong exception, masking what should have been a clean
RLS-permission rejection with a misleading "first contact must be primary" one instead. Fixed by
making the trigger `security definer`, so its own reads always reflect ground truth regardless of
who's calling - caught by `tests/rls/contacts.spec.ts`'s own "bde outside the deal's practice" case
before this was ever applied to the hosted project (the buggy version had already been applied once;
the fix was reapplied as a targeted `create or replace function`, verified `security_type = DEFINER`
via `information_schema.routines` afterward).

Applied to the real hosted project via the Management API, same as every migration since `0006`;
`schema_migrations` there now lists `0001` through `0018`. `tests/rls/contacts.spec.ts` (11 tests,
against local Postgres) proves both tables' RLS shape (`contacts` mirrors `accounts_select`/
`accounts_update` exactly via `account_has_entitled_practice()`; `deal_contacts` mirrors
`deal_co_owners_select`/`deal_co_owners_insert` exactly, per `contact.link_to_deal` sharing
`deal.add_co_owner`'s own own/practice/practice/-/tenant scope) and both trigger-enforced invariants
directly. `tests/integration/contacts.spec.ts` (7 tests, against the real hosted project, real
signed-in sessions) proves `createContact`/`linkContactToDeal` end to end: an entitled bde creates a
contact and links it to their own deal (becoming primary automatically, being the deal's first); a
bde with no entitlement to the account is denied creating one; a bde outside the deal's practice
can't even see the deal (`not_found`, the same RLS-invisibility precedent `changeStage`/
`logActivity` already established, not a new `denied` shape); linking a contact from a different
(but visible) account is rejected with a clean `contact_wrong_account` code rather than a raw
exception from the trigger; and linking the same contact twice is rejected as `already_linked`.
`contact.create`/`contact.update`/`contact.link_to_deal` were already fully scaffolded in
`src/auth/permissions.ts` from early on (the same "scaffolded early, unused" situation M5.4 found
for `analytics.view_practice`) but had no dedicated per-action scope test until now - new
`tests/permissions/contact-matrix.spec.ts` (21 tests) closes that gap. No new UI - schema and service
layer only, per the backlog's own split from M5.6 ("Contact management on the deal").

## `0019_activity_contacts` (M5.7)

Closes the deferral chain migration `0008`'s own header comment opened at M3.1: `activity_contacts`
was named there and explicitly deferred to this exact milestone ("the same deliverable under a
different name, scheduled after contacts actually exists"), and `contacts.last_engaged_at` (migration
`0018`) has carried "no write path yet (M5.7)" in its own column comment since M5.5. Both close here.

Deliberately narrower than `deal_contacts` (migration `0018`): just `activity_id, contact_id` as its
primary key, no `decision_role`/`is_primary`-shaped columns at all - `docs/01-domain-model.md`'s own
field list for this table is that bare join, unlike the richer list it gives `deal_contacts`, so this
follows that narrower shape on purpose. Insert-only, no update/delete policy - the same reasoning
`0018` gave for `deal_contacts`, doubled here since activities themselves are append-only (CLAUDE.md
#4): a join table recording who was present at an activity can't legitimately need editing either.

`validate_activity_contact()` (before-insert, `security definer`) enforces a rule no doc states
outright but treats the same way `0018`'s own `contact_wrong_account` check does: a contact must
already be linked to the activity's own deal via `deal_contacts` before it can be attributed to an
activity on that deal - "stakeholders" and "contacts present at an engagement" are the same set, and
letting them disagree would contradict the Stakeholders section (M5.6) itself. `security definer` is
required for the identical reason `0018`'s own `validate_deal_contact()` needed it (documented there
as a real bug that migration's own verification pass caught) - applied here proactively, not
rediscovered: a plain invoker-rights version would let a caller outside the deal's practice see a
false "not linked" (since `deal_contacts_select` already hides every row from them) and trip this
exception instead of the RLS-permission rejection that should stop them first.

Two trigger functions maintain `contacts.last_engaged_at`, the contact-level analogue of migration
`0009`'s own `refresh_deal_engagement()`: `refresh_contact_engagement(contact_id)` is a single-contact
full recompute (max `activity_date` where `is_client_facing` and not retracted, scoped through
`activity_contacts` rather than `activities.deal_id` directly) - deliberately not one `GROUP BY`
query across every affected contact, since a plain aggregate keyed to a single fixed id always
returns exactly one row (correctly resetting to null once nothing qualifies), whereas a `GROUP BY`
would silently drop a contact from its result the moment their last qualifying activity is retracted,
leaving a stale value instead of resetting it. `trg_activity_contact_refresh` (`AFTER INSERT ON
activity_contacts`) calls it at attribution time; `trg_activity_update_refresh_contacts` (`AFTER
UPDATE ON activities`, mirroring `0009`'s own INSERT-OR-UPDATE reasoning one join-hop further out)
calls it for every contact currently attributed to an activity that's just been edited or retracted -
without this second trigger, retracting an activity that had already been attributed to a contact
would leave that contact's `last_engaged_at` reflecting an engagement CLAUDE.md #4's retraction
discipline says should no longer count.

No new permission action: `docs/02-permission-matrix.md` names no `activity.attribute_contact` (or
similar) anywhere, so attribution rides along with `activity.create`'s own existing scope - the same
way `activity.attach_file` (migration `0010`) already piggybacks on the activity being created rather
than needing its own grant. `activity_contacts_insert`/`activity_contacts_select` mirror
`activities_insert`/`activities_select` (and `documents_insert`'s own identical mirror of them)
exactly, through the activity's own `deal_id` - own/practice/practice/denied/tenant for insert,
tenant-wide-for-executive/tenant_admin-else-practice for select.

Verified locally before the hosted apply: applied/rolled-back/re-applied against local Postgres, plus
a manual SQL smoke test proving all three behaviours directly (attributing a not-yet-linked contact
raises the expected exception; attributing a linked one sets `last_engaged_at` to the activity's own
`activity_date`; retracting that activity resets it to null). New `tests/rls/activity_contacts.spec.ts`
(8 tests, local Postgres) proves the same shape through the real RLS/trigger stack. Applied to the
real hosted project via the Management API (a Personal Access Token supplied ad hoc in chat, the same
mechanism this file's own `0006`/`0007` note describes - this sandbox has no raw Postgres/DNS egress
to the hosted project, confirmed directly by testing `DATABASE_URL` itself, which fails DNS
resolution); `schema_migrations` there now lists `0001` through `0019`, and `security_type = DEFINER`
was confirmed directly on all four new functions. Two new tests in `tests/integration/log-activity.spec.ts`
prove `logActivity`'s own `contactIds` handling end to end against the real hosted project.

## 0020_pipeline_stage_bottleneck_threshold

M6.3 (docs/07-build-backlog.md): "Time in stage with median headline; bottleneck highlighting." A
single nullable column - `pipeline_stages.bottleneck_threshold_days` - with a `check (> 0)`
constraint and no cross-tenant default. "Bottleneck" is never defined anywhere in the docs set (it
appears exactly once, in the backlog line itself); asked directly, the product owner chose an
absolute, per-stage, tenant_admin-editable threshold over a relative "worst of N stages" comparison
or a single tenant-wide number (docs/DECISIONS.md D-17) - Discovery and Negotiation don't take the
same amount of time by nature, and there is no reasonable single default to seed every tenant's
every stage with the way the loss-reason value bands (D-12) could.

No RLS change: migration `0005`'s own `pipeline_stages_update` policy (tenant_admin-only) already
covers this column - it has existed since M1.1 with no real caller and, a genuine gap found while
building this milestone, no RLS test of its own until now. Both close here: `src/services/
pipelineStages.ts` (the new `/admin/pipeline-stages` settings screen, mirroring M5.1's Outcome
Reasons admin screen exactly - `can()` gate plus `writeAudit`) is the first real caller, and three
new tests were added to `tests/rls/deals_foundation.spec.ts`'s existing "pipeline_stages:
tenant-wide read, tenant_admin-only write" block (tenant_admin can update; a bde cannot, rowCount 0
not thrown, since a denied UPDATE's `USING` clause matches zero candidate rows rather than raising
the way a denied INSERT's `WITH CHECK` does; a tenant_admin cannot update another tenant's stage).

Verified locally before the hosted apply: applied/rolled-back/re-applied against local Postgres, and
a from-scratch `db:setup:local` confirmed 285 RLS tests pass (282 plus the three new ones). Applied
to the real hosted project via the Management API (a Personal Access Token supplied ad hoc in chat,
the same mechanism this file's own `0006`/`0007`/`0019` notes describe); `schema_migrations` there
now lists `0001` through `0020`, and the column's presence/nullability was confirmed directly via
`information_schema.columns`. New `tests/integration/pipeline-stages-admin.spec.ts` (2 tests) and
`tests/integration/time-in-stage.spec.ts` (3 tests) prove the admin screen and the `getTimeInStage`
metric end to end against the real hosted project, including the exact 10-transit minimum-sample
boundary and a reconstructed-only transit never being counted.

## 0021_user_roles_manager

M6.5 (docs/07-build-backlog.md): "Engagement analytics... all role-scoped." `docs/04-metric-
definitions.md`'s own "Engagement coverage" text is the first metric requiring a "team" scope
narrower than "practice" ("own deals for a BDE, **team** for a Team Lead, practice for a Director,
tenant for Executive and Tenant Admin") - nothing in the schema distinguished them before now;
`getTeamOverview` (M4.6) had already documented this exact gap in its own comments. Asked directly in
two follow-up rounds rather than defaulted (docs/DECISIONS.md D-18): build a real team concept now (a
`manager_id` column, not a fixed default the way the M6.3 bottleneck threshold could have been), with
a real settings screen (`/admin/team-assignments`) rather than a column-only placeholder, and update
`getTeamOverview`'s own already-shipped behaviour to match rather than letting "team" mean two
different things depending on which screen a Team Lead is looking at.

A single nullable `user_roles.manager_id uuid references users(id)` - lives on `user_roles`, not
`users`, since a manager relationship is a property of ONE role grant, mirroring every other "who"
column already on this table (`granted_by`). No cross-tenant default: an unassigned bde is simply not
on anyone's team roster yet, reading as their own Team Lead's team of just themselves (the confirmed
fallback) rather than a misleadingly-inflated practice-wide number standing in for an unconfigured
team.

Validated by a trigger (`validate_user_roles_manager()`, before insert or update, `security
definer`), not a `CHECK` constraint - the rule spans two rows (this grant's own tenant_id/
practice_line_id, and the referenced manager's own role row), which a single-row CHECK cannot
express. `security definer` for the identical reason migrations `0018`/`0019`'s own contact-
validation triggers needed it: this function's own lookup into `user_roles` must see ground truth
regardless of the calling actor's own RLS visibility. Deliberately narrow: a manager must be an
active `team_lead` in the SAME tenant and practice line as the row being assigned - this milestone
only ever sets `manager_id` on bde-role rows, so validating against `team_lead` specifically (not
"team_lead or director") keeps the rule exactly as strict as what's actually being built.

No RLS change: migration `0003`'s own `user_roles_update` policy (tenant_admin-only) already covers
this column - it has existed since M0.2 with no real caller and no RLS test of its own until this
milestone gives it one (`src/services/teamAssignments.ts`, four new tests in
`tests/rls/foundation.spec.ts`), the identical "scaffolded early, closed here" story migration
`0020`'s own `pipeline_stages_update` gap already told.

Verified locally before the hosted apply: applied/rolled-back/re-applied against local Postgres, plus
a manual `psql` smoke test proving both trigger behaviours directly (a valid manager insert succeeds;
an invalid one raises the expected exception). `tests/rls/foundation.spec.ts` grew from 15 to 19
tests in its own file (289 total in the RLS suite, up from 285). Applied to the real hosted project
via the Management API (a Personal Access Token supplied ad hoc in chat, the same mechanism this
file's own `0006`/`0007`/`0019`/`0020` notes describe); `schema_migrations` there now lists `0001`
through `0021`, and the column's presence was confirmed directly via `information_schema.columns`.
New `tests/integration/team-assignments.spec.ts` (4 tests) and `tests/integration/engagement-
analytics.spec.ts` (5 tests) prove the new admin screen and the `getEngagementAnalytics` metric end
to end against the real hosted project, including the trigger's own rejection message and a team_lead
whose direct reports genuinely differ from their whole practice; `tests/integration/team.spec.ts`'s
own pre-existing suite was updated in place to prove `getTeamOverview`'s corrected behaviour (4
tests, including the unassigned-Team-Lead fallback), run against the real hosted project with no
regressions across the full 192-test integration suite.
