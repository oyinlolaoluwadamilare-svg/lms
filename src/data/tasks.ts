import type { SupabaseClient } from "@supabase/supabase-js";

export interface TaskForAuthorization {
  id: string;
  tenantId: string;
  dealId: string | null;
  assigneeId: string;
  assignedById: string;
  practiceLineId: string | null;
}

interface TaskForAuthorizationRow {
  id: string;
  tenant_id: string;
  deal_id: string | null;
  assignee_id: string;
  assigned_by: string;
  deal: { practice_line_id: string } | null;
}

// For assignTask's authorisation check (src/services/tasks.ts) - mirrors getActivityForAuthorization's
// shape. practiceLineId is resolved through the task's deal (tasks has no own practice_line_id
// column, migration 0011) via a nested embed on deals - RLS-safe because tasks_select already
// requires the caller to be entitled to the deal's practice line whenever deal_id is set, so this
// embed can never surface a deal the caller couldn't otherwise see. A null dealId yields a null
// practiceLineId, which tokenMatches's "practice" branch never matches - only the tenant-wide/
// assigned/assigned_by tokens apply to a deal-less personal task, the same scope shape migration
// 0011's own tasks_select RLS policy already enforces at the database layer. Reads through the
// caller's own RLS-scoped session (tasks_select) - null means either the task doesn't exist, is
// soft-deleted, or isn't visible to this actor, the same not-confirming-existence reasoning every
// other not_found case in this codebase already uses.
export async function getTaskForAuthorization(supabase: SupabaseClient, taskId: string): Promise<TaskForAuthorization | null> {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, tenant_id, deal_id, assignee_id, assigned_by, deal:deals!deal_id(practice_line_id)")
    .eq("id", taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new Error(`getTaskForAuthorization failed: ${error.message}`);
  if (!data) return null;

  const row = data as unknown as TaskForAuthorizationRow;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    dealId: row.deal_id,
    assigneeId: row.assignee_id,
    assignedById: row.assigned_by,
    practiceLineId: row.deal?.practice_line_id ?? null,
  };
}

// The single path for changing who a task is assigned to (docs/07-build-backlog.md M4.2's
// assignTask). Reads/writes through the CALLER's own RLS-scoped session (tasks_update, migration
// 0011), not a service-role client: unlike activity.retract, task.reassign's scope (assigned/
// practice/tenant per role) already matches tasks_update's own USING clause exactly, so there is no
// gap here for a service-role client to close. assigned_by is set to the reassigning actor on every
// call (not left unchanged) - both for correct "who most recently assigned this" semantics, and so
// the resulting row still satisfies tasks_update's own RLS check via the assigned_by = auth.uid()
// branch even when the actor reassigns a task away from themselves (losing the assignee_id =
// auth.uid() branch) - the same "does the row I'm about to produce still satisfy my own policy"
// question migration 0010's documents_soft_delete discovery taught this codebase to ask up front.
export async function applyTaskReassignment(supabase: SupabaseClient, taskId: string, newAssigneeId: string, assignedBy: string): Promise<void> {
  const { error } = await supabase
    .from("tasks")
    .update({ assignee_id: newAssigneeId, assigned_by: assignedBy })
    .eq("id", taskId);

  if (error) throw new Error(`applyTaskReassignment failed: ${error.message}`);
}

// task_assignments is the immutable reassignment ledger (migration 0011: forbid_mutation trigger,
// no insert policy for `authenticated` at all) - every write goes through a service-role client, the
// same shape retractActivityRow/writeAudit already use for privileged single-path writes.
// fromUserId is nullable only for a task's very first assignment at creation time; every call from
// assignTask (reassignment of an existing task) always has a real previous assignee.
export async function insertTaskAssignment(
  serviceClient: SupabaseClient,
  taskId: string,
  fromUserId: string | null,
  toUserId: string,
  assignedBy: string,
): Promise<void> {
  const { error } = await serviceClient.from("task_assignments").insert({
    task_id: taskId,
    from_user_id: fromUserId,
    to_user_id: toUserId,
    assigned_by: assignedBy,
  });

  if (error) throw new Error(`insertTaskAssignment failed: ${error.message}`);
}
