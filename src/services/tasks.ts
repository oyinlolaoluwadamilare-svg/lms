import type { SupabaseClient } from "@supabase/supabase-js";
import { can, type Actor } from "@/auth/permissions";
import { applyTaskReassignment, getTaskForAuthorization, insertTaskAssignment } from "@/data/tasks";
import { insertNotification } from "@/data/notifications";
import { getUserByAuthId } from "@/data/users";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAudit } from "@/services/audit";

export type AssignTaskResult = { ok: true } | { ok: false; code: "not_found" | "denied" | "same_assignee" | "invalid_assignee" };

// The single assignment path (docs/07-build-backlog.md M4.2: "`assignTask` as the single assignment
// path, writing the ledger entry and notification"). Operates on an EXISTING task only
// (reassignment) - every task already has an assignee from creation (migration 0011:
// tasks.assignee_id not null), so there is no separate "first assignment" path to build here.
//
// Checks task.reassign only, NOT task.assign_to_other - the latter is a different action
// (docs/02-permission-matrix.md: creating/adding a NEW assignment, whose "practice" grant for bde
// carries footnote 3, "co-owners, own team lead, practice peers", a scope src/auth/permissions.ts's
// Resource shape cannot express today). task.reassign's own scope (assigned/practice/tenant/null per
// role) is exactly what THIS operation needs and is already fully expressible with today's Resource
// shape (assigneeId/assignedById/practiceLineId) - no gap there. The gap this DOES leave, disclosed
// rather than silently invented: nothing here validates that newAssigneeId is a co-owner/team-lead/
// practice-peer of the actor per footnote 3's richer rule for WHO a task may land on - only that
// newAssigneeId is a real, active user in the same tenant (a data-integrity check, not a business-
// scope one). Closing that gap needs either a new ScopeToken or a bespoke resource field this file
// does not invent unasked.
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
  // its redundant .eq("status", "active").
  const newAssignee = await getUserByAuthId(supabase, newAssigneeId);
  if (!newAssignee || newAssignee.tenantId !== task.tenantId) {
    return { ok: false, code: "invalid_assignee" };
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
