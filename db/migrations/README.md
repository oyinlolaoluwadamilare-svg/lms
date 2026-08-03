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
