import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaskPriority, TaskStatus } from "@/domain/task";
import { dateInTimezone, subtractDaysFromPlainDate } from "@/lib/dates";

export interface TaskForAuthorization {
  id: string;
  tenantId: string;
  dealId: string | null;
  assigneeId: string;
  assignedById: string;
  practiceLineId: string | null;
  status: TaskStatus;
  dueDate: string;
  snoozeCount: number;
}

interface TaskForAuthorizationRow {
  id: string;
  tenant_id: string;
  deal_id: string | null;
  assignee_id: string;
  assigned_by: string;
  status: TaskStatus;
  due_date: string;
  snooze_count: number;
  deal: { practice_line_id: string } | null;
}

// For assignTask/completeTask/snoozeTask's authorisation checks (src/services/tasks.ts) - mirrors
// getActivityForAuthorization's "one getter, several callers with an identical need" shape.
// practiceLineId is resolved through the task's deal (tasks has no own practice_line_id column,
// migration 0011) via a nested embed on deals - RLS-safe because tasks_select already requires the
// caller to be entitled to the deal's practice line whenever deal_id is set, so this embed can never
// surface a deal the caller couldn't otherwise see. A null dealId yields a null practiceLineId,
// which tokenMatches's "practice" branch never matches - only the tenant-wide/assigned/assigned_by
// tokens apply to a deal-less personal task, the same scope shape migration 0011's own tasks_select
// RLS policy already enforces at the database layer. Reads through the caller's own RLS-scoped
// session (tasks_select) - null means either the task doesn't exist, is soft-deleted, or isn't
// visible to this actor, the same not-confirming-existence reasoning every other not_found case in
// this codebase already uses. status/dueDate/snoozeCount (M4.5) are here too since completeTask and
// snoozeTask both need them for their own business-rule checks (already-done/already-cancelled,
// must-be-later, reason-required-after-two-snoozes) - the same "fetch once, several callers need the
// same extra columns" reasoning that added lastEngagedAt to getDealDetail rather than a new query.
export async function getTaskForAuthorization(supabase: SupabaseClient, taskId: string): Promise<TaskForAuthorization | null> {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, tenant_id, deal_id, assignee_id, assigned_by, status, due_date, snooze_count, deal:deals!deal_id(practice_line_id)")
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
    status: row.status,
    dueDate: row.due_date,
    snoozeCount: row.snooze_count,
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

export interface NewTaskInput {
  tenantId: string;
  dealId: string | null;
  originActivityId: string | null;
  title: string;
  description: string | null;
  assigneeId: string;
  assignedBy: string;
  dueDate: string; // YYYY-MM-DD
  priority: TaskPriority;
}

export interface InsertedTask {
  id: string;
}

// The only place application code inserts into tasks - called exclusively by
// src/services/tasks.ts's createTask (docs/07-build-backlog.md M4.3). Reads/writes through the
// CALLER's own RLS-scoped session (tasks_insert, migration 0011) - there IS an insert policy for
// `authenticated` on this table, the same shape insertActivity's own comment already establishes for
// why no service-role client is needed here. `status` is left to its column default ('open') and
// `assigned_by` is always the creating actor themselves at creation time - a task can only ever be
// created with the creator as its own first assigner, never on someone else's behalf.
export async function insertTask(supabase: SupabaseClient, input: NewTaskInput): Promise<InsertedTask> {
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      tenant_id: input.tenantId,
      deal_id: input.dealId,
      origin_activity_id: input.originActivityId,
      title: input.title,
      description: input.description,
      assignee_id: input.assigneeId,
      assigned_by: input.assignedBy,
      due_date: input.dueDate,
      priority: input.priority,
    })
    .select("id")
    .single();

  if (error) throw new Error(`insertTask failed: ${error.message}`);
  return { id: (data as unknown as { id: string }).id };
}

// task_assignments is the immutable reassignment ledger (migration 0011: forbid_mutation trigger,
// no insert policy for `authenticated` at all) - every write goes through a service-role client, the
// same shape retractActivityRow/writeAudit already use for privileged single-path writes.
// fromUserId is nullable for exactly one caller, createTask's own first-assignment row (the domain
// model's own words: "the very first assignment at task creation has no 'from'") - every call from
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

// docs/07-build-backlog.md M4.5's "inline complete" - reads/writes through the CALLER's own
// RLS-scoped session (tasks_update, migration 0011), the same reasoning applyTaskReassignment's own
// comment gives: task.complete's scope already matches tasks_update's USING clause, no service-role
// client needed. Sets both completed_at/completed_by together, satisfying migration 0011's own
// done_needs_completion check constraint in the same statement.
export async function applyTaskCompletion(supabase: SupabaseClient, taskId: string, completedBy: string): Promise<void> {
  const { error } = await supabase
    .from("tasks")
    .update({ status: "done", completed_at: new Date().toISOString(), completed_by: completedBy })
    .eq("id", taskId);

  if (error) throw new Error(`applyTaskCompletion failed: ${error.message}`);
}

// docs/07-build-backlog.md M4.5's "snooze with reason after two snoozes" - same caller-session
// write shape as applyTaskCompletion/applyTaskReassignment. The reason itself is not stored as a
// column on tasks (no such column exists, and none is added by this milestone - see
// src/services/tasks.ts's snoozeTask for why): it is written to audit_entries instead, via the
// caller's own writeAudit call, since a task can be snoozed many times and a single overwritable
// column would lose every reason but the most recent one, unlike activity.retract's one-time
// terminal retraction_reason column.
export async function applyTaskSnooze(supabase: SupabaseClient, taskId: string, newDueDate: string, newSnoozeCount: number): Promise<void> {
  const { error } = await supabase.from("tasks").update({ due_date: newDueDate, snooze_count: newSnoozeCount }).eq("id", taskId);

  if (error) throw new Error(`applyTaskSnooze failed: ${error.message}`);
}

export interface TaskQueueItem {
  id: string;
  title: string;
  dueDate: string;
  priority: TaskPriority;
  status: TaskStatus;
  snoozeCount: number;
  assigneeId: string;
  assigneeName: string;
  dealId: string | null;
  dealName: string | null;
  accountName: string | null;
}

interface TaskQueueRow {
  id: string;
  title: string;
  due_date: string;
  priority: TaskPriority;
  status: TaskStatus;
  snooze_count: number;
  assignee_id: string;
  assignee: { full_name: string } | null;
  deal: { id: string; name: string; account: { name: string } | null } | null;
}

// The My Work screen's queue (docs/07-build-backlog.md M4.5: "grouped queue... plus the 'Assigned by
// me' tab"). `scope` picks which of the two tabs this call is for - explicitly filtered by
// assignee_id/assigned_by, NOT left to tasks_select's own broader RLS visibility alone: a
// team_lead/director's tasks_select is practice-wide (any task in an entitled practice), but "my
// work" is a PERSONAL queue - "assigned to me" must never include a colleague's task just because
// the viewer could also see it via practice entitlement. Reads through the caller's own RLS-scoped
// session; open/in_progress/blocked only (done/cancelled tasks don't belong in an open work queue).
// Ordered by due_date so the grouping this function's caller does (src/domain/task.ts's
// taskQueueGroup) sees overdue/due-soonest tasks first within each bucket.
export async function listMyWorkTasks(supabase: SupabaseClient, userId: string, scope: "assignee" | "assigner"): Promise<TaskQueueItem[]> {
  let query = supabase
    .from("tasks")
    .select(
      "id, title, due_date, priority, status, snooze_count, assignee_id, " +
        "assignee:users!assignee_id(full_name), deal:deals!deal_id(id, name, account:accounts!account_id(name))",
    )
    .is("deleted_at", null)
    .in("status", ["open", "in_progress", "blocked"]);

  query = scope === "assignee" ? query.eq("assignee_id", userId) : query.eq("assigned_by", userId);

  const { data, error } = await query.order("due_date", { ascending: true });
  if (error) throw new Error(`listMyWorkTasks failed: ${error.message}`);

  return (data as unknown as TaskQueueRow[]).map((row) => ({
    id: row.id,
    title: row.title,
    dueDate: row.due_date,
    priority: row.priority,
    status: row.status,
    snoozeCount: row.snooze_count,
    assigneeId: row.assignee_id,
    assigneeName: row.assignee?.full_name ?? "Unknown",
    dealId: row.deal?.id ?? null,
    dealName: row.deal?.name ?? null,
    accountName: row.deal?.account?.name ?? null,
  }));
}

// For the Handover panel (M5.9: "last ten engagements, open tasks and contacts, shown on owner
// change"). Batched across every deal id given in one call, the same reasoning M5.7/M5.8's own
// batched siblings (listContactsForActivities, listActivitiesForDeals, etc.) already establish -
// works identically for a single deal's own handover (one id) or a whole practice-line
// relationship's handover across an account's several deals (M5.9's own "both" scope). Reads
// through the caller's own RLS-scoped session, same reasoning listMyWorkTasks already gives:
// tasks_select already scopes rows to the caller's tenant/practice entitlement, filtered further
// here to open/in_progress/blocked only, the same "an open work queue" definition listMyWorkTasks
// already uses.
export async function listOpenTasksForDeals(supabase: SupabaseClient, dealIds: string[]): Promise<TaskQueueItem[]> {
  if (dealIds.length === 0) return [];

  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, title, due_date, priority, status, snooze_count, assignee_id, " +
        "assignee:users!assignee_id(full_name), deal:deals!deal_id(id, name, account:accounts!account_id(name))",
    )
    .is("deleted_at", null)
    .in("status", ["open", "in_progress", "blocked"])
    .in("deal_id", dealIds)
    .order("due_date", { ascending: true });

  if (error) throw new Error(`listOpenTasksForDeals failed: ${error.message}`);

  return (data as unknown as TaskQueueRow[]).map((row) => ({
    id: row.id,
    title: row.title,
    dueDate: row.due_date,
    priority: row.priority,
    status: row.status,
    snoozeCount: row.snooze_count,
    assigneeId: row.assignee_id,
    assigneeName: row.assignee?.full_name ?? "Unknown",
    dealId: row.deal?.id ?? null,
    dealName: row.deal?.name ?? null,
    accountName: row.deal?.account?.name ?? null,
  }));
}

export interface TeamMemberTaskCounts {
  open: number;
  overdue: number;
  completedRecently: number;
}

interface TeamTaskCountRow {
  assignee_id: string;
  status: TaskStatus;
  due_date: string;
  completed_at: string | null;
}

// M4.6's Team view (docs/07-build-backlog.md: "per-person open, overdue and completed counts").
// Reads through the CALLER's own RLS-scoped session, NOT a service-role client - tasks_select's
// own practice branch (migration 0011) requires deal_id is not null, so a deal-less personal task
// assigned to someone OTHER than the caller stays invisible even to a team_lead/director viewing
// their own team; this is the same privacy boundary RLS already establishes everywhere else, not a
// new gap this function introduces or should route around. "completed recently" has no doc to
// point to - a rolling 7-day window, the same judgment call src/domain/task.ts's own taskQueueGroup
// "this week" bucket already made, so this count doesn't grow unbounded forever; `timezone` is the
// VIEWER's own (CLAUDE.md #8), since completed_at is a real TIMESTAMPTZ instant that needs
// resolving through a timezone, unlike due_date's plain-DATE comparisons elsewhere in this file.
export async function getTeamTaskCounts(
  supabase: SupabaseClient,
  memberIds: string[],
  timezone: string,
  now: Date = new Date(),
): Promise<Map<string, TeamMemberTaskCounts>> {
  const counts = new Map<string, TeamMemberTaskCounts>();
  for (const id of memberIds) counts.set(id, { open: 0, overdue: 0, completedRecently: 0 });
  if (memberIds.length === 0) return counts;

  const today = dateInTimezone(now.toISOString(), timezone);
  const recentCutoff = subtractDaysFromPlainDate(today, 7);

  const { data, error } = await supabase.from("tasks").select("assignee_id, status, due_date, completed_at").in("assignee_id", memberIds).is("deleted_at", null);

  if (error) throw new Error(`getTeamTaskCounts failed: ${error.message}`);

  for (const row of data as unknown as TeamTaskCountRow[]) {
    const bucket = counts.get(row.assignee_id);
    if (!bucket) continue;

    if (row.status === "open" || row.status === "in_progress" || row.status === "blocked") {
      bucket.open += 1;
      if (row.due_date < today) bucket.overdue += 1;
    } else if (row.status === "done" && row.completed_at) {
      if (dateInTimezone(row.completed_at, timezone) >= recentCutoff) bucket.completedRecently += 1;
    }
  }

  return counts;
}
