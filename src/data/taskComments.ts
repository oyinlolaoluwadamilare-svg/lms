import type { SupabaseClient } from "@supabase/supabase-js";

export interface TaskComment {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string;
  body: string;
  resolvedAt: string | null;
  resolvedByName: string | null;
  createdAt: string;
}

interface TaskCommentRow {
  id: string;
  task_id: string;
  author_id: string;
  body: string;
  resolved_at: string | null;
  created_at: string;
  author: { full_name: string } | null;
  resolved_by_user: { full_name: string } | null;
}

// M4.9 (docs/07-build-backlog.md): "Comments, watchers and @mention with an in-scope user picker."
// Oldest first - a comment thread reads top-to-bottom chronologically, the same convention
// task_assignments' own ledger ordering (M4.2) already established for a similarly append-only log.
export async function listTaskComments(supabase: SupabaseClient, taskId: string): Promise<TaskComment[]> {
  const { data, error } = await supabase
    .from("task_comments")
    .select("id, task_id, author_id, body, resolved_at, created_at, author:users!author_id(full_name), resolved_by_user:users!resolved_by(full_name)")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`listTaskComments failed: ${error.message}`);
  return (data as unknown as TaskCommentRow[]).map((row) => ({
    id: row.id,
    taskId: row.task_id,
    authorId: row.author_id,
    authorName: row.author?.full_name ?? "Unknown",
    body: row.body,
    resolvedAt: row.resolved_at,
    resolvedByName: row.resolved_by_user?.full_name ?? null,
    createdAt: row.created_at,
  }));
}

export async function insertTaskComment(supabase: SupabaseClient, taskId: string, authorId: string, body: string): Promise<{ id: string }> {
  const { data, error } = await supabase.from("task_comments").insert({ task_id: taskId, author_id: authorId, body }).select("id").single();

  if (error) throw new Error(`insertTaskComment failed: ${error.message}`);
  return { id: (data as { id: string }).id };
}

export interface CommentForAuthorization {
  id: string;
  taskId: string;
  authorId: string;
}

// For resolveTaskComment's authorisation check - just enough to resolve the PARENT task's own
// tenant/practice/assignee/assigned_by shape (mirrors getTaskForAuthorization's own "one getter for
// several callers" reasoning), since task.resolve_comment's scope is about the TASK's state, not the
// comment's own authorship (docs/02-permission-matrix.md's new footnote 4).
export async function getCommentForAuthorization(supabase: SupabaseClient, commentId: string): Promise<CommentForAuthorization | null> {
  const { data, error } = await supabase.from("task_comments").select("id, task_id, author_id").eq("id", commentId).maybeSingle();

  if (error) throw new Error(`getCommentForAuthorization failed: ${error.message}`);
  if (!data) return null;
  const row = data as { id: string; task_id: string; author_id: string };
  return { id: row.id, taskId: row.task_id, authorId: row.author_id };
}

// RLS (migration 0015's task_comments_resolve policy) is coarse - it gates WHO may update the row
// at all, not WHICH columns; only ever setting resolved_at/resolved_by here, never body/author_id,
// is what keeps this precise, the same "RLS is coarse, the service is exact" split
// notifications_mark_read's own service call already established.
export async function setCommentResolution(supabase: SupabaseClient, commentId: string, resolved: boolean, actorId: string): Promise<void> {
  const { error } = await supabase
    .from("task_comments")
    .update(resolved ? { resolved_at: new Date().toISOString(), resolved_by: actorId } : { resolved_at: null, resolved_by: null })
    .eq("id", commentId);

  if (error) throw new Error(`setCommentResolution failed: ${error.message}`);
}
