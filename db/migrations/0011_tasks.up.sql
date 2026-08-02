-- M4.1: tasks, task_assignments, task_comments, task_watchers, with the blocked and done
-- constraints (docs/01-domain-model.md).
--
-- Deliberate deviations from db/schema.sql, called out rather than silently reproduced:
--
-- 1. `tasks.contact_id` references contacts(id), and `contacts` (M5.5) does not exist yet in this
--    codebase - the same "a table cannot reference a table that isn't there" reasoning migrations
--    0008/0010 already gave for deferring `activity_contacts`/`documents.contact_id`. Not created
--    until its dependency is real.
-- 2. `next_action_task_id`/`next_action_due_date`'s derivation trigger (`refresh_deal_next_action()`
--    in db/schema.sql) is deliberately NOT built here - docs/07-build-backlog.md names it explicitly
--    as M4.4's own deliverable ("next_action_task_id derivation trigger"), the identical M3.1/M3.2
--    split this codebase already established for the engagement-trigger (migration 0008 built the
--    activities table only; migration 0009, a separate later milestone, built the cross-table
--    derived-field trigger). This migration creates table structure only.
-- 3. `updated_by` is added to `tasks` even though db/schema.sql's own definition omits it -
--    docs/01-domain-model.md's own general rule ("every mutable table carries created_at,
--    updated_at, created_by, updated_by") already led migration 0005 to add it to
--    accounts/deals over db/schema.sql's identical omission there; the same fix applies here.
--    Wired to migration 0006's existing `set_updated_at_and_by()` trigger - reused verbatim, no
--    redefinition needed.
-- 4. RLS substitutes migration 0005's `deal_practice_line_id()`/`deal_owner_id()`/
--    `deal_author_id()`/`is_deal_co_owner()` security-definer helpers for db/schema.sql's own raw
--    `exists (select 1 from deals d where d.id = deal_id and ...)` joins - the identical
--    cross-table RLS recursion reasoning migrations 0007/0008/0010 already gave for the same
--    substitution on stage_events/activities/documents. New helper functions
--    (`task_tenant_id`/`task_deal_id`/`task_assignee_id`/`task_assigned_by`) are added for
--    task_assignments/task_comments/task_watchers' own policies, the same "resolve through the
--    parent row via a security-definer function" shape `deal_co_owners`/`activity_revisions`
--    already established for a child table with no `tenant_id` column of its own.
--
-- A genuine, direct doc conflict, resolved by explicit user decision rather than a silent pick:
-- docs/01-domain-model.md's own tasks field list says "due_date (NOT NULL)", but docs/06-ui-spec.md's
-- My Work screen names a "No date" grouping bucket, which only makes sense if a task can have no due
-- date. Decided: `due_date` stays NOT NULL, following the domain model literally - the "No date"
-- bucket (M4.5, not built yet) will simply always be empty in this codebase for now, the same
-- narrower-than-spec-UI shape this session has taken repeatedly rather than loosening a NOT NULL
-- constraint on a guess.
--
-- Two further scope decisions, deferred rather than guessed, each flagged in place below:
-- task_comments' `resolved_at`/`resolved_by` mutation path (who may resolve a comment, and how) is
-- undocumented anywhere and not named by any M4 backlog line - no UPDATE policy is created for
-- `authenticated` yet, deliberately not `forbid_mutation()` either (unlike task_assignments, which
-- the domain model explicitly calls "the immutable reassignment ledger") since resolution is a real,
-- plausible future write path, just not one anything asks for yet. Snooze reasons (M4.5's own "snooze
-- with reason after two snoozes") have no documented column anywhere - `tasks.snooze_count` exists
-- (per the domain model) but no `snooze_reason` column is added here; that decision belongs to M4.5,
-- the milestone that actually builds snoozing, not this one.

create type task_status   as enum ('open', 'in_progress', 'blocked', 'done', 'cancelled');
create type task_priority as enum ('low', 'normal', 'high', 'urgent');

create table tasks (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  deal_id uuid references deals(id),
  account_id uuid references accounts(id),
  origin_activity_id uuid references activities(id),
  title text not null check (length(btrim(title)) > 0),
  description text,
  assignee_id uuid not null references users(id),
  assigned_by uuid not null references users(id),
  due_date date not null,
  due_time time,
  priority task_priority not null default 'normal',
  status task_status not null default 'open',
  blocked_reason text,
  snooze_count int not null default 0,
  completed_at timestamptz,
  completed_by uuid references users(id),
  template_item_id uuid,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id),
  deleted_at timestamptz,
  constraint blocked_needs_reason check (
    status <> 'blocked' or length(btrim(coalesce(blocked_reason, ''))) > 0
  ),
  constraint done_needs_completion check (
    status <> 'done' or (completed_at is not null and completed_by is not null)
  )
);
create index tasks_my_work on tasks (assignee_id, due_date) where status in ('open', 'in_progress', 'blocked');
create index tasks_delegated on tasks (assigned_by, status);
create index tasks_overdue on tasks (tenant_id, due_date) where status in ('open', 'in_progress');

create trigger tasks_set_updated_at
  before update on tasks
  for each row execute function set_updated_at_and_by();

-- "the immutable reassignment ledger" (docs/01-domain-model.md) - from_user_id is nullable (the
-- very first assignment at task creation has no "from"), to_user_id/assigned_by are not.
create table task_assignments (
  id uuid primary key default uuid_generate_v4(),
  task_id uuid not null references tasks(id),
  from_user_id uuid references users(id),
  to_user_id uuid not null references users(id),
  assigned_by uuid not null references users(id),
  assigned_at timestamptz not null default now()
);

create table task_comments (
  id uuid primary key default uuid_generate_v4(),
  task_id uuid not null references tasks(id),
  author_id uuid not null references users(id),
  body text not null check (length(btrim(body)) > 0),
  resolved_at timestamptz,
  resolved_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table task_watchers (
  task_id uuid not null references tasks(id),
  user_id uuid not null references users(id),
  added_by uuid references users(id),
  added_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

-- Resolve tenant/scope through the parent `tasks` row for the three child tables above, none of
-- which carry a tenant_id column of their own - the same shape migration 0005's deal_tenant_id()/
-- deal_practice_line_id() already established for deal_co_owners.
create or replace function task_tenant_id(p_task_id uuid) returns uuid
language sql stable security definer as $$
  select tenant_id from tasks where id = p_task_id
$$;

create or replace function task_deal_id(p_task_id uuid) returns uuid
language sql stable security definer as $$
  select deal_id from tasks where id = p_task_id
$$;

create or replace function task_assignee_id(p_task_id uuid) returns uuid
language sql stable security definer as $$
  select assignee_id from tasks where id = p_task_id
$$;

create or replace function task_assigned_by(p_task_id uuid) returns uuid
language sql stable security definer as $$
  select assigned_by from tasks where id = p_task_id
$$;

alter table tasks             enable row level security;
alter table task_assignments  enable row level security;
alter table task_comments     enable row level security;
alter table task_watchers     enable row level security;

-- docs/02-permission-matrix.md's Tasks section: task.view is "own+assigned+practice" for bde
-- (interpreted, per src/auth/permissions.ts's own header comment, as assignee OR assigner OR
-- practice-entitled - tasks have no owner/co-owner/author concept of their own), "practice" for
-- team_lead/director, "tenant" for executive/tenant_admin. A task with no deal_id (a personal/
-- administrative task - docs/06-ui-spec.md's Add Task modal calls "linked deal" optional) is only
-- visible to its own assignee/assigner or tenant-wide roles, never by practice alone - there is no
-- deal to derive a practice from.
create policy tasks_select on tasks for select using (
  tenant_id = current_tenant_id() and deleted_at is null and (
    has_role('tenant_admin') or has_role('executive')
    or assignee_id = auth.uid() or assigned_by = auth.uid()
    or (deal_id is not null and deal_practice_line_id(deal_id) in (select entitled_practices()))
  )
);

-- task.create: practice (bde/team_lead/director), tenant (tenant_admin), denied (executive).
-- docs/01-domain-model.md's own invariant - "assignee_id must be within the assigner's permission
-- scope at time of assignment" - is NOT an RLS-expressible rule (it depends on the relationship
-- between the assigner and the SPECIFIC assignee, e.g. "is this person my practice peer, my team
-- lead, or a co-owner of this deal" per footnote 3 on task.assign_to_other) - that is M4.2's
-- assignTask service's job via can(), the same "RLS is coarse, can() is the fine-grained rule"
-- split tests/rls/deals_permission_matrix.spec.ts's own documented finding already established for
-- deal.change_owner. This policy only enforces tenant/practice scope on the task's OWN deal
-- linkage, same as db/schema.sql's own shape: a deal-less task has no practice to check against,
-- so any practice-scoped writer may create one (that they must still populate a VALID assignee is
-- can()'s job, not RLS's).
create policy tasks_insert on tasks for insert with check (
  tenant_id = current_tenant_id() and can_write() and (
    has_role('tenant_admin')
    or deal_id is null
    or deal_practice_line_id(deal_id) in (select entitled_practices())
  )
);

-- task.update: "own+assigned" (bde - assignee or assigner), practice (team_lead/director), tenant
-- (tenant_admin), denied (executive). task.complete/task.cancel are narrower shapes of this same
-- action for bde specifically (assigned+own vs. assigned_by-only) - RLS cannot distinguish "the
-- assignee marking done" from "the assigner cancelling" any more than deals_update can distinguish
-- change_stage from change_owner (the same documented RLS-granularity limit) - can() in the service
-- layer (M4.2+) is where that finer distinction is actually enforced; this policy is the coarse
-- boundary every task.update-shaped action shares.
create policy tasks_update on tasks for update using (
  tenant_id = current_tenant_id() and can_write() and deleted_at is null and (
    has_role('tenant_admin') or assignee_id = auth.uid() or assigned_by = auth.uid()
    or ((has_role('director') or has_role('team_lead'))
        and deal_id is not null and deal_practice_line_id(deal_id) in (select entitled_practices()))
  )
);
-- No delete policy on tasks: soft delete only (CLAUDE.md #3), via an update setting deleted_at.

-- task_assignments: read-only for `authenticated`, same visibility as the parent task (one level
-- removed, the same shape activity_revisions_select already established for activity_id ->
-- activities.deal_id). No insert/update/delete policy for `authenticated` at all - a real
-- reassignment write is M4.2's assignTask, a service-role-backed single path (mirroring
-- writeStageEvent/writeAudit's own shape) precisely because this ledger must never be caller-
-- forgeable. forbid_mutation() (migration 0004, reused verbatim) blocks update/delete outright,
-- for every identity including service_role - "immutable" per the domain model, the same
-- guarantee stage_events/audit_entries already have.
create policy task_assignments_select on task_assignments for select using (
  task_tenant_id(task_id) = current_tenant_id() and (
    has_role('tenant_admin') or has_role('executive')
    or task_assignee_id(task_id) = auth.uid() or task_assigned_by(task_id) = auth.uid()
    or (task_deal_id(task_id) is not null and deal_practice_line_id(task_deal_id(task_id)) in (select entitled_practices()))
  )
);
create trigger trg_no_update_task_assignments before update or delete on task_assignments
  for each statement execute function forbid_mutation();

-- task_comments: task.comment is "visible" (docs/02-permission-matrix.md's own footnote: "same set
-- as task.view") for read AND write alike - anyone who can see the task can comment on it. No
-- update/delete policy for `authenticated` yet - see this migration's header comment on
-- resolved_at/resolved_by being a deferred, undecided scope, not a permanently-immutable ledger.
create policy task_comments_select on task_comments for select using (
  task_tenant_id(task_id) = current_tenant_id() and (
    has_role('tenant_admin') or has_role('executive')
    or task_assignee_id(task_id) = auth.uid() or task_assigned_by(task_id) = auth.uid()
    or (task_deal_id(task_id) is not null and deal_practice_line_id(task_deal_id(task_id)) in (select entitled_practices()))
  )
);
create policy task_comments_insert on task_comments for insert with check (
  can_write() and author_id = auth.uid() and task_tenant_id(task_id) = current_tenant_id() and (
    has_role('tenant_admin') or has_role('executive')
    or task_assignee_id(task_id) = auth.uid() or task_assigned_by(task_id) = auth.uid()
    or (task_deal_id(task_id) is not null and deal_practice_line_id(task_deal_id(task_id)) in (select entitled_practices()))
  )
);

-- task_watchers: table created now (this migration's own named deliverable), but no INSERT policy
-- yet - docs/02-permission-matrix.md has no "add watcher" action at all (the same "not invented
-- here" reasoning migration 0005's deal_co_owners_insert comment already gives for the analogous
-- gap: "no deal.remove_co_owner action yet"), and M4.9 ("Comments, watchers and @mention with an
-- in-scope user picker") is the milestone that actually specifies who may add one. Select-only for
-- now, same visibility shape as task_comments/task_assignments.
create policy task_watchers_select on task_watchers for select using (
  task_tenant_id(task_id) = current_tenant_id() and (
    has_role('tenant_admin') or has_role('executive')
    or task_assignee_id(task_id) = auth.uid() or task_assigned_by(task_id) = auth.uid()
    or (task_deal_id(task_id) is not null and deal_practice_line_id(task_deal_id(task_id)) in (select entitled_practices()))
  )
);
