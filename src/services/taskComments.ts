import type { SupabaseClient } from "@supabase/supabase-js";
import { can, type Actor, type Resource } from "@/auth/permissions";
import { getTaskForAuthorization } from "@/data/tasks";
import { getCommentForAuthorization, insertTaskComment, listTaskComments, setCommentResolution, type TaskComment } from "@/data/taskComments";
import { insertTaskWatcher, listTaskWatchers, type TaskWatcher } from "@/data/taskWatchers";
import { listAssignableUsersForPractice, listAssignableUsersForTenant, type AssignableUser } from "@/data/users";
import { createServiceClient } from "@/lib/supabase/service";
import { sendNotification } from "@/services/notifications";

// M4.9 (docs/07-build-backlog.md): "Comments, watchers and @mention with an in-scope user picker."
//
// @mention is implemented as picking from an in-scope picker (the same population
// listAssignableUsersForPractice/Tenant already produces for the assignee picker, matching
// docs/02-permission-matrix.md's task.mention_user sharing task.assign_to_other's exact scope
// shape), not by parsing @handle syntax out of free-text comment bodies. A structured mention
// markup would need its own escaping/rendering rules nothing here asks for; picking a real user
// from a real picker is unambiguous by construction and satisfies "an in-scope user picker" - the
// backlog line's own words - literally, not just in spirit.
//
// Watchers are BOTH automatic and manual, by explicit user decision (not invented here):
// automatic - a task's assignee and assigner become watchers from creation (src/services/tasks.ts's
// createTask), reassignment adds the new assignee (assignTask), and an @mention in a comment adds
// the mentioned user (this file's own createTaskComment, below). Manual - addWatcher below covers
// both self-add (task.watch) and adding someone else (task.add_watcher, re-validated against the
// same in-scope picker population the assignee/mention pickers already use - RLS alone cannot
// verify a SECOND person's own role, the identical "you can only pick who the picker offered"
// re-check createTask's own assignee validation already established). A comment's own AUTHOR is
// deliberately NOT auto-added as a watcher merely for commenting - only assignment/reassignment/
// mention trigger the automatic path; if the author is already the assignee or assigner they are
// already watching from task creation regardless.
//
// Comment resolution is scoped like task.update (task.resolve_comment), not like authorship - the
// task's assignee/assigner (or a practice lead) may resolve feedback on it even if someone else
// wrote the comment, since resolving is treated as changing the task's own state.

async function taskResource(supabase: SupabaseClient, taskId: string) {
  const task = await getTaskForAuthorization(supabase, taskId);
  if (!task) return null;
  const resource: Resource = {
    tenantId: task.tenantId,
    practiceLineId: task.practiceLineId ?? undefined,
    assigneeId: task.assigneeId,
    assignedById: task.assignedById,
  };
  return { task, resource };
}

async function inScopeUserIds(supabase: SupabaseClient, tenantId: string, practiceLineId: string | null): Promise<Set<string>> {
  const users: AssignableUser[] = practiceLineId
    ? await listAssignableUsersForPractice(supabase, tenantId, practiceLineId)
    : await listAssignableUsersForTenant(supabase, tenantId);
  return new Set(users.map((user) => user.id));
}

export interface TaskCommentsContext {
  canComment: boolean;
  canAddWatcher: boolean;
  canWatchSelf: boolean;
  comments: Array<TaskComment & { canResolve: boolean }>;
  watchers: TaskWatcher[];
  mentionCandidates: AssignableUser[];
}

// Fetched on demand when a task's own "Comments" panel opens (mirrors getReassignContext's own
// "not pre-fetched for the whole page" shape) - one round trip for the comment list, watcher list,
// mention/add-watcher candidate population, and every per-comment/per-action permission flag the
// UI needs, so the client never has to re-derive can() logic itself (CLAUDE.md #1: UI hiding is
// never the sole control, but it still needs to know what to show).
export async function getTaskCommentsContext(supabase: SupabaseClient, actor: Actor, taskId: string): Promise<TaskCommentsContext | null> {
  const found = await taskResource(supabase, taskId);
  if (!found) return null;
  const { task, resource } = found;

  const canResolve = can(actor, "task.resolve_comment", resource);
  const needsCandidates = can(actor, "task.comment", resource) || can(actor, "task.add_watcher", resource);
  const [comments, watchers, mentionCandidates] = await Promise.all([
    listTaskComments(supabase, taskId),
    listTaskWatchers(supabase, taskId),
    needsCandidates
      ? task.practiceLineId
        ? listAssignableUsersForPractice(supabase, task.tenantId, task.practiceLineId)
        : listAssignableUsersForTenant(supabase, task.tenantId)
      : Promise.resolve([]),
  ]);

  return {
    canComment: can(actor, "task.comment", resource),
    canAddWatcher: can(actor, "task.add_watcher", resource),
    canWatchSelf: can(actor, "task.watch", resource) && !watchers.some((w) => w.userId === actor.id),
    comments: comments.map((comment) => ({ ...comment, canResolve })),
    watchers,
    mentionCandidates,
  };
}

export type CreateTaskCommentResult = { ok: true; commentId: string } | { ok: false; code: "not_found" | "denied" | "invalid_mention" };

export async function createTaskComment(
  supabase: SupabaseClient,
  actor: Actor,
  taskId: string,
  body: string,
  mentionedUserIds: string[],
): Promise<CreateTaskCommentResult> {
  const found = await taskResource(supabase, taskId);
  if (!found) return { ok: false, code: "not_found" };
  const { task, resource } = found;

  if (!can(actor, "task.comment", resource)) return { ok: false, code: "denied" };

  const uniqueMentions = [...new Set(mentionedUserIds)];
  if (uniqueMentions.length > 0) {
    const validIds = await inScopeUserIds(supabase, task.tenantId, task.practiceLineId);
    if (!uniqueMentions.every((id) => validIds.has(id))) return { ok: false, code: "invalid_mention" };
  }

  const comment = await insertTaskComment(supabase, taskId, actor.id, body);

  // notifications has no insert policy for `authenticated` at all (service-role only, migration
  // 0012) - the same reason createTask/assignTask's own sendNotification calls already use a
  // service client, not the caller's own RLS-scoped session. task_watchers, by contrast, DOES allow
  // this through the caller's own session (migration 0015), so that insert stays on `supabase`.
  const serviceClient = createServiceClient();
  for (const mentionedUserId of uniqueMentions) {
    await insertTaskWatcher(supabase, taskId, mentionedUserId, actor.id);
    if (mentionedUserId === actor.id) continue; // no self-notification, same as createTask's self-assign skip
    await sendNotification(serviceClient, {
      tenantId: task.tenantId,
      recipientId: mentionedUserId,
      actorId: actor.id,
      eventType: "mentioned",
      entityType: "task",
      entityId: taskId,
      title: "You were mentioned in a comment",
    });
  }

  return { ok: true, commentId: comment.id };
}

export type ResolveTaskCommentResult = { ok: true } | { ok: false; code: "not_found" | "denied" };

export async function resolveTaskComment(supabase: SupabaseClient, actor: Actor, commentId: string, resolved: boolean): Promise<ResolveTaskCommentResult> {
  const comment = await getCommentForAuthorization(supabase, commentId);
  if (!comment) return { ok: false, code: "not_found" };

  const found = await taskResource(supabase, comment.taskId);
  if (!found) return { ok: false, code: "not_found" };

  if (!can(actor, "task.resolve_comment", found.resource)) return { ok: false, code: "denied" };

  await setCommentResolution(supabase, commentId, resolved, actor.id);
  return { ok: true };
}

export type AddWatcherResult = { ok: true } | { ok: false; code: "not_found" | "denied" | "invalid_watcher" };

export async function addWatcher(supabase: SupabaseClient, actor: Actor, taskId: string, userId: string): Promise<AddWatcherResult> {
  const found = await taskResource(supabase, taskId);
  if (!found) return { ok: false, code: "not_found" };
  const { task, resource } = found;

  const isSelf = userId === actor.id;
  if (!can(actor, isSelf ? "task.watch" : "task.add_watcher", resource)) return { ok: false, code: "denied" };

  if (!isSelf) {
    const validIds = await inScopeUserIds(supabase, task.tenantId, task.practiceLineId);
    if (!validIds.has(userId)) return { ok: false, code: "invalid_watcher" };
  }

  await insertTaskWatcher(supabase, taskId, userId, actor.id);
  return { ok: true };
}
