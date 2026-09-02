import type { SupabaseClient } from "@supabase/supabase-js";
import { can, type Actor, type Resource } from "@/auth/permissions";
import {
  applyTaskCompletion,
  applyTaskReassignment,
  applyTaskSnooze,
  getTaskForAuthorization,
  getTeamTaskCounts,
  insertTask,
  insertTaskAssignment,
  listMyWorkTasks,
  type TaskQueueItem,
} from "@/data/tasks";
import { insertTaskWatcher } from "@/data/taskWatchers";
import { sendNotification } from "@/services/notifications";
import {
  getUserByAuthId,
  listAssignableUsersForPractice,
  listAssignableUsersForTenant,
  listDirectReports,
  listTeamMembersForPractice,
  type AssignableUser,
} from "@/data/users";
import { getDealForAuthorization } from "@/data/deals";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAudit } from "@/services/audit";
import { snoozeReasonRequired, type TaskPriority } from "@/domain/task";

// Re-exported for `app` callers (AddTaskModal.tsx, LogActivityModal.tsx, my-work/page.tsx) - the
// layering guardrail (eslint.config.mjs's boundaries/element-types) forbids `app` importing from
// `data` directly, the same reasoning every other app-facing type in this codebase flows through
// its own service module.
export type { AssignableUser, TaskQueueItem };

export type AssignTaskResult = { ok: true } | { ok: false; code: "not_found" | "denied" | "same_assignee" | "invalid_assignee" };

// The single assignment path (docs/07-build-backlog.md M4.2: "`assignTask` as the single assignment
// path, writing the ledger entry and notification"). Operates on an EXISTING task only
// (reassignment) - every task already has an assignee from creation (migration 0011:
// tasks.assignee_id not null), so there is no separate "first assignment" path to build here.
//
// Checks task.reassign only, NOT task.assign_to_other - the latter is a different action
// (docs/02-permission-matrix.md: creating/adding a NEW assignment). task.reassign's own scope
// (assigned/practice/tenant/null per role) only ever validates the ACTOR's own relationship to the
// task/deal - like every can() check, it cannot validate a SECOND person's (the new assignee's) own
// role, since Resource carries no field for "the target's own practice_line_id". Originally this
// function's own comment treated that as an acceptable, disclosed gap; M4.3's createTask hit the
// identical gap for real (a bde could assign a brand-new task to a user in a completely different
// practice line) and closed it with an explicit re-check against listAssignableUsersForPractice - the
// same fix is applied here, for the same reason: reassigning an existing task to an out-of-scope
// user is no safer than creating one already pointed at them. For a deal-less personal task
// (task.practiceLineId null), the re-check is skipped for the same "no practice to check against"
// reason createTask's own comment gives - only the real-active-same-tenant-user check further down
// still applies there.
export async function assignTask(supabase: SupabaseClient, actor: Actor, taskId: string, newAssigneeId: string): Promise<AssignTaskResult> {
  const task = await getTaskForAuthorization(supabase, taskId);
  if (!task) return { ok: false, code: "not_found" };

  if (
    !can(actor, "task.reassign", {
      tenantId: task.tenantId,
      practiceLineId: task.practiceLineId ?? undefined,
      assigneeId: task.assigneeId,
      assignedById: task.assignedById,
    })
  ) {
    return { ok: false, code: "denied" };
  }

  if (newAssigneeId === task.assigneeId) return { ok: false, code: "same_assignee" };

  // Data-integrity check, not a business-scope one (see header comment): getUserByAuthId is
  // RLS-scoped to the caller's own tenant (users_select), so a cross-tenant id simply comes back
  // null here - the explicit tenantId comparison below documents that intent rather than relying
  // silently on RLS internals, the same reasoning getUserByAuthId's own comment already gives for
  // its redundant .eq("status", "active"). Deliberately checked BEFORE the practice-scope re-check
  // just below: a bogus/nonexistent id is invalid_assignee (it could never be "in scope" or "out of
  // scope" - it isn't anyone), while a real user in the wrong practice is a genuine scope denial.
  const newAssignee = await getUserByAuthId(supabase, newAssigneeId);
  if (!newAssignee || newAssignee.tenantId !== task.tenantId) {
    return { ok: false, code: "invalid_assignee" };
  }

  if (task.practiceLineId) {
    const eligibleAssignees = await listAssignableUsersForPractice(supabase, task.tenantId, task.practiceLineId);
    if (!eligibleAssignees.some((user) => user.id === newAssigneeId)) {
      return { ok: false, code: "denied" };
    }
  }

  const previousAssigneeId = task.assigneeId;
  await applyTaskReassignment(supabase, taskId, newAssigneeId, actor.id);

  const serviceClient = createServiceClient();
  await insertTaskAssignment(serviceClient, taskId, previousAssigneeId, newAssigneeId, actor.id);

  await sendNotification(serviceClient, {
    tenantId: task.tenantId,
    recipientId: newAssigneeId,
    actorId: actor.id,
    eventType: "task_reassigned",
    entityType: "task",
    entityId: taskId,
    title: "A task was assigned to you",
  });

  // M4.9's automatic-watcher decision: reassignment adds the NEW assignee as a watcher. Additive
  // only - the previous assignee (and anyone else already watching) stays a watcher too; there is
  // no "unwatch" action (docs/02-permission-matrix.md's new footnote 4). Through the caller's own
  // RLS-scoped session, not serviceClient - migration 0015's task_watchers_insert policy already
  // permits this (the actor performing a reassignment necessarily has task-visibility), so there is
  // no need for a service-role write here the way task_assignments/notifications require.
  await insertTaskWatcher(supabase, taskId, newAssigneeId, actor.id);

  await writeAudit({
    tenantId: actor.tenantId,
    actorId: actor.id,
    entityType: "task",
    entityId: taskId,
    action: "task.reassign",
    before: { assigneeId: previousAssigneeId },
    after: { assigneeId: newAssigneeId },
  });

  return { ok: true };
}

export interface CreateTaskInput {
  dealId: string | null;
  originActivityId: string | null;
  title: string;
  description: string | null;
  assigneeId: string;
  dueDate: string; // YYYY-MM-DD
  priority: TaskPriority;
}

export type CreateTaskResult = { ok: true; task: { id: string } } | { ok: false; code: "not_found" | "denied" | "invalid_assignee" };

// The single task-creation path (docs/07-build-backlog.md M4.3: "Add Task modal with the
// scope-filtered assignee picker"). docs/01-domain-model.md's own tasks invariant - "assignee_id
// must be within the assigner's permission scope at time of assignment" - is enforced here via
// can() PLUS one explicit query, not can() alone: task.create/task.assign_to_self/
// task.assign_to_other only ever check the ACTOR's own role against the resource (does the actor
// hold a grant matching this deal's practice line) - tokenMatches has no way to check a SECOND
// person's (the assignee's) own role at all, since Resource carries no field for "the target's own
// practice_line_id". A first version of this function assumed footnote 3 ("co-owners, own team
// lead, practice peers") reduced to plain practice-membership and could be left to can() alone; a
// real integration test caught that this let a bde assign a task to a user in a COMPLETELY
// different practice line, because can() was only ever validating the actor's side of the
// relationship. Fixed by re-checking the chosen assignee themselves, below, against
// listAssignableUsersForPractice - the identical query the picker itself uses, so "you can only
// pick who the picker offered" is actually true server-side, not just a UI convention (CLAUDE.md #1).
//
// When dealId is null (a personal/administrative task with no deal to derive a practice from),
// `resource` is left undefined entirely rather than built with a null practiceLineId - can()'s own
// "no specific record to check" branch then trivially permits any role holding a non-null entry for
// task.create/task.assign_to_self/task.assign_to_other, the identical relaxed shape migration
// 0011's tasks_insert policy already documents for a deal-less task ("any practice-scoped writer may
// create one"); the practice-membership re-check below is skipped in that case too, for the same
// "no practice to check against" reason - only the real-active-same-tenant-user check further down
// still applies.
export async function createTask(supabase: SupabaseClient, actor: Actor, input: CreateTaskInput): Promise<CreateTaskResult> {
  let practiceLineId: string | undefined;
  if (input.dealId) {
    const deal = await getDealForAuthorization(supabase, input.dealId);
    if (!deal) return { ok: false, code: "not_found" };
    practiceLineId = deal.practiceLineId;
  }

  const resource: Resource | undefined = practiceLineId
    ? { tenantId: actor.tenantId, practiceLineId, assigneeId: input.assigneeId }
    : undefined;

  if (!can(actor, "task.create", resource)) return { ok: false, code: "denied" };

  const isSelfAssign = input.assigneeId === actor.id;
  if (!can(actor, isSelfAssign ? "task.assign_to_self" : "task.assign_to_other", resource)) {
    return { ok: false, code: "denied" };
  }

  // Data-integrity check, not a business-scope one (see header comment) - the same shape
  // assignTask's own identical check already established, including the same ordering rationale:
  // a bogus/nonexistent id is invalid_assignee, checked before the practice-scope re-check below can
  // ever turn a "not anyone real" case into a misleading "denied".
  const newAssignee = await getUserByAuthId(supabase, input.assigneeId);
  if (!newAssignee || newAssignee.tenantId !== actor.tenantId) {
    return { ok: false, code: "invalid_assignee" };
  }

  if (!isSelfAssign && practiceLineId) {
    const eligibleAssignees = await listAssignableUsersForPractice(supabase, actor.tenantId, practiceLineId);
    if (!eligibleAssignees.some((user) => user.id === input.assigneeId)) {
      return { ok: false, code: "denied" };
    }
  }

  const task = await insertTask(supabase, {
    tenantId: actor.tenantId,
    dealId: input.dealId,
    originActivityId: input.originActivityId,
    title: input.title,
    description: input.description,
    assigneeId: input.assigneeId,
    assignedBy: actor.id,
    dueDate: input.dueDate,
    priority: input.priority,
  });

  const serviceClient = createServiceClient();
  // fromUserId null: this task's very first assignment (src/data/tasks.ts's own comment on
  // insertTaskAssignment).
  await insertTaskAssignment(serviceClient, task.id, null, input.assigneeId, actor.id);

  // "Assigning to someone else surfaces 'They will be notified'" (docs/06-ui-spec.md) - so a
  // self-assigned task deliberately sends no notification, the same reasoning that copy implies:
  // you don't need to be told you assigned yourself something.
  if (!isSelfAssign) {
    await sendNotification(serviceClient, {
      tenantId: actor.tenantId,
      recipientId: input.assigneeId,
      actorId: actor.id,
      eventType: "task_assigned",
      entityType: "task",
      entityId: task.id,
      title: "A task was assigned to you",
    });
  }

  // M4.9's automatic-watcher decision: a task's assignee AND assigner become watchers from
  // creation. insertTaskWatcher's own upsert-ignore-duplicates makes the self-assigned case (both
  // are the same person) a harmless single row, not a double-insert. Through the caller's own
  // RLS-scoped session - migration 0015's task_watchers_insert policy already permits this for
  // whoever just created the task.
  await insertTaskWatcher(supabase, task.id, input.assigneeId, actor.id);
  await insertTaskWatcher(supabase, task.id, actor.id, actor.id);

  await writeAudit({
    tenantId: actor.tenantId,
    actorId: actor.id,
    entityType: "task",
    entityId: task.id,
    action: "task.create",
    after: { dealId: input.dealId, assigneeId: input.assigneeId, dueDate: input.dueDate, priority: input.priority },
  });

  return { ok: true, task: { id: task.id } };
}

export interface AddTaskContext {
  canAddTask: boolean;
  assignableUsers: AssignableUser[];
}

// For the deal detail page to decide whether to show the "Add Task" button, and if so, what to
// populate its scope-filtered assignee picker with - one round trip, since both depend on the same
// deal fetch. Mirrors canLogActivity/canRetractActivity's "returns false for a deal that doesn't
// exist or isn't visible" shape for the boolean half; bundled with the picker data (rather than a
// second, separate canCreateTask-only function) because a caller that needs one always needs the
// other in the same request, and getDealForAuthorization is not free to call twice.
export async function getAddTaskContext(supabase: SupabaseClient, actor: Actor, dealId: string): Promise<AddTaskContext> {
  const deal = await getDealForAuthorization(supabase, dealId);
  if (!deal) return { canAddTask: false, assignableUsers: [] };

  const canAddTask = can(actor, "task.create", { tenantId: deal.tenantId, practiceLineId: deal.practiceLineId });
  if (!canAddTask) return { canAddTask: false, assignableUsers: [] };

  const assignableUsers = await listAssignableUsersForPractice(supabase, deal.tenantId, deal.practiceLineId);
  return { canAddTask: true, assignableUsers };
}

export type CompleteTaskResult = { ok: true } | { ok: false; code: "not_found" | "denied" | "already_done" | "cancelled" };

// docs/07-build-backlog.md M4.5's "inline complete". task.complete's scope (docs/02-permission-
// matrix.md: assigned+own for bde - assignee OR assigner; practice for team_lead/director; tenant
// for tenant_admin) happens to be the identical token set as task.update's for every role in this
// matrix, so there is no separate RLS gap to worry about here beyond tasks_update's own USING clause
// (migration 0011) - the same reasoning migration 0011's own comment already gives for why RLS
// cannot (and does not need to) distinguish task.complete from task.update/task.cancel at the
// database layer.
export async function completeTask(supabase: SupabaseClient, actor: Actor, taskId: string): Promise<CompleteTaskResult> {
  const task = await getTaskForAuthorization(supabase, taskId);
  if (!task) return { ok: false, code: "not_found" };

  if (
    !can(actor, "task.complete", {
      tenantId: task.tenantId,
      practiceLineId: task.practiceLineId ?? undefined,
      assigneeId: task.assigneeId,
      assignedById: task.assignedById,
    })
  ) {
    return { ok: false, code: "denied" };
  }

  if (task.status === "done") return { ok: false, code: "already_done" };
  if (task.status === "cancelled") return { ok: false, code: "cancelled" };

  await applyTaskCompletion(supabase, taskId, actor.id);

  await writeAudit({
    tenantId: actor.tenantId,
    actorId: actor.id,
    entityType: "task",
    entityId: taskId,
    action: "task.complete",
    before: { status: task.status },
    after: { status: "done" },
  });

  return { ok: true };
}

export type SnoozeTaskResult =
  | { ok: true }
  | { ok: false; code: "not_found" | "denied" | "already_done" | "cancelled" | "must_be_later" | "reason_required" };

// docs/07-build-backlog.md M4.5's "snooze with reason after two snoozes" - checked via task.update
// (the same reasoning completeTask's own comment gives: docs/02-permission-matrix.md has no
// distinct "task.snooze" action at all, and snoozing is fundamentally a due_date field edit).
//
// Two scope decisions this milestone had to make with no doc to point to, both flagged rather than
// silently invented: (1) `newDueDate` must be strictly later than the task's CURRENT due_date - a
// "snooze" that moves a date earlier or leaves it unchanged isn't a snooze, it's a plain edit (no
// "edit task" feature exists yet in this codebase to route that through instead); (2) the reason
// text is written to audit_entries (action "task.snooze"), not a new `snooze_reason` column - a
// task can be snoozed many times, and a single column would only ever hold the latest reason,
// silently discarding every earlier one, unlike activity.retract's one-time terminal
// retraction_reason column. src/domain/task.ts's snoozeReasonRequired is the single shared
// definition of "after two snoozes" the UI uses too, so there is exactly one place that says "2".
export async function snoozeTask(
  supabase: SupabaseClient,
  actor: Actor,
  taskId: string,
  newDueDate: string,
  reason: string | null,
): Promise<SnoozeTaskResult> {
  const task = await getTaskForAuthorization(supabase, taskId);
  if (!task) return { ok: false, code: "not_found" };

  if (
    !can(actor, "task.update", {
      tenantId: task.tenantId,
      practiceLineId: task.practiceLineId ?? undefined,
      assigneeId: task.assigneeId,
      assignedById: task.assignedById,
    })
  ) {
    return { ok: false, code: "denied" };
  }

  if (task.status === "done") return { ok: false, code: "already_done" };
  if (task.status === "cancelled") return { ok: false, code: "cancelled" };
  if (newDueDate <= task.dueDate) return { ok: false, code: "must_be_later" };

  const trimmedReason = reason?.trim() || null;
  if (snoozeReasonRequired(task.snoozeCount) && !trimmedReason) {
    return { ok: false, code: "reason_required" };
  }

  const newSnoozeCount = task.snoozeCount + 1;
  await applyTaskSnooze(supabase, taskId, newDueDate, newSnoozeCount);

  await writeAudit({
    tenantId: actor.tenantId,
    actorId: actor.id,
    entityType: "task",
    entityId: taskId,
    action: "task.snooze",
    before: { dueDate: task.dueDate, snoozeCount: task.snoozeCount },
    after: { dueDate: newDueDate, snoozeCount: newSnoozeCount, reason: trimmedReason },
  });

  return { ok: true };
}

// The My Work screen's two tabs (docs/07-build-backlog.md M4.5: "plus the 'Assigned by me' tab" -
// "Assigned to me" is the implicit default every other role-scoped screen in this codebase already
// treats as the primary view). No can() check here: "my own tasks" (by explicit assignee_id/
// assigned_by match, not by role-derived practice scope) is inherently self-scoped, the same
// reasoning analytics.view_own's "self" token already encodes elsewhere in the permission matrix -
// there is no privileged action to authorise beyond "is this session active", which the caller's own
// RLS session already establishes.
export async function listMyWork(supabase: SupabaseClient, actor: Actor, tab: "assigned_to_me" | "assigned_by_me"): Promise<TaskQueueItem[]> {
  return listMyWorkTasks(supabase, actor.id, tab === "assigned_to_me" ? "assignee" : "assigner");
}

export interface ReassignContext {
  canReassign: boolean;
  assignableUsers: AssignableUser[];
}

// For My Work's inline "Reassign" action (M4.5): unlike the Add Task modal (M4.3, one deal per
// page load) or the deal detail header (one deal per page), My Work lists tasks across MANY
// different deals/practices in a single queue - there is no single practice-scoped picker to
// pre-fetch for the whole page. Fetched on demand, per task, only when its own Reassign control is
// opened (mirroring getAddTaskContext's shape, but scoped by TASK via getTaskForAuthorization
// instead of by deal via getDealForAuthorization, and checking task.reassign instead of
// task.create).
export async function getReassignContext(supabase: SupabaseClient, actor: Actor, taskId: string): Promise<ReassignContext> {
  const task = await getTaskForAuthorization(supabase, taskId);
  if (!task) return { canReassign: false, assignableUsers: [] };

  const canReassign = can(actor, "task.reassign", {
    tenantId: task.tenantId,
    practiceLineId: task.practiceLineId ?? undefined,
    assigneeId: task.assigneeId,
    assignedById: task.assignedById,
  });
  if (!canReassign) return { canReassign: false, assignableUsers: [] };

  // A deal-less task has no practice to scope the picker by - fall back to the tenant-wide listing
  // (src/data/users.ts's own listAssignableUsersForTenant, built in M4.3 specifically for "the
  // my-work/global 'Add Task' entry point M4.5 will add" - this is that entry point) rather than
  // leaving the picker empty and unusable.
  const assignableUsers = task.practiceLineId
    ? await listAssignableUsersForPractice(supabase, task.tenantId, task.practiceLineId)
    : await listAssignableUsersForTenant(supabase, task.tenantId);
  return { canReassign: true, assignableUsers };
}

export interface TeamMemberOverview {
  id: string;
  fullName: string;
  role: AssignableUser["role"];
  open: number;
  overdue: number;
  completedRecently: number;
}

export type TeamOverviewResult = { ok: true; members: TeamMemberOverview[] } | { ok: false; code: "denied" };

// M4.6's Team view (docs/07-build-backlog.md: "Team view for Team Lead and Director with
// per-person open, overdue and completed counts"). Updated by M6.5 (docs/07-build-backlog.md:
// "Engagement analytics... all role-scoped") to use the real "team" concept migration 0021
// introduced (manager_id) rather than the practice-wide stand-in this comment used to describe: a
// Director's own grant still means every working-role holder in that practice line (task.view is
// practice-scoped for that role, so a tenant-wide roster would over-reach what they're entitled to
// see), but a Team Lead's own grant now means only their direct reports (listDirectReports,
// including themselves per the confirmed fallback - docs/DECISIONS.md D-18) - one consistent
// meaning of "team" everywhere, not a narrower one on the Analytics page and a wider one here. An
// actor holding no team_lead/director grant at all (a plain bde, or none) is denied - this view
// exists for leaders, not individual contributors. An actor holding both kinds of grant for the
// SAME practice line (unusual, not forbidden by the role model) sees the union, which in that case
// is simply the wider, practice-wide set - listTeamMembersForPractice's own result already
// contains everything listDirectReports would for that same practice.
export async function getTeamOverview(supabase: SupabaseClient, actor: Actor, timezone: string, now: Date = new Date()): Promise<TeamOverviewResult> {
  const grants = actor.roleGrants.filter((grant) => (grant.role === "team_lead" || grant.role === "director") && grant.practiceLineId);
  if (grants.length === 0) return { ok: false, code: "denied" };

  const membersByGrant = await Promise.all(
    grants.map((grant) =>
      grant.role === "director"
        ? listTeamMembersForPractice(supabase, actor.tenantId, grant.practiceLineId as string)
        : listDirectReports(supabase, actor.tenantId, grant.practiceLineId as string, actor.id),
    ),
  );
  const membersById = new Map<string, AssignableUser>();
  for (const list of membersByGrant) {
    for (const member of list) membersById.set(member.id, member);
  }

  const counts = await getTeamTaskCounts(supabase, [...membersById.keys()], timezone, now);

  const members: TeamMemberOverview[] = [...membersById.values()]
    .map((member) => {
      const memberCounts = counts.get(member.id) ?? { open: 0, overdue: 0, completedRecently: 0 };
      return { id: member.id, fullName: member.fullName, role: member.role, ...memberCounts };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  return { ok: true, members };
}
