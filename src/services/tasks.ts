import type { SupabaseClient } from "@supabase/supabase-js";
import { can, type Actor, type Resource } from "@/auth/permissions";
import { applyTaskReassignment, getTaskForAuthorization, insertTask, insertTaskAssignment } from "@/data/tasks";
import { insertNotification } from "@/data/notifications";
import { getUserByAuthId, listAssignableUsersForPractice, type AssignableUser } from "@/data/users";
import { getDealForAuthorization } from "@/data/deals";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAudit } from "@/services/audit";
import type { TaskPriority } from "@/domain/task";

// Re-exported for `app` callers (AddTaskModal.tsx, LogActivityModal.tsx) - the layering guardrail
// (eslint.config.mjs's boundaries/element-types) forbids `app` importing from `data` directly, the
// same reasoning every other app-facing type in this codebase flows through its own service module.
export type { AssignableUser };

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

  await insertNotification(serviceClient, {
    tenantId: task.tenantId,
    recipientId: newAssigneeId,
    actorId: actor.id,
    eventType: "task_reassigned",
    entityType: "task",
    entityId: taskId,
    title: "A task was assigned to you",
  });

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
    await insertNotification(serviceClient, {
      tenantId: actor.tenantId,
      recipientId: input.assigneeId,
      actorId: actor.id,
      eventType: "task_assigned",
      entityType: "task",
      entityId: task.id,
      title: "A task was assigned to you",
    });
  }

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
