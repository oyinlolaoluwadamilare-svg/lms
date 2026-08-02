import type { SupabaseClient } from "@supabase/supabase-js";

export interface TaskWatcher {
  userId: string;
  fullName: string;
  addedAt: string;
}

interface TaskWatcherRow {
  user_id: string;
  added_at: string;
  user: { full_name: string } | null;
}

export async function listTaskWatchers(supabase: SupabaseClient, taskId: string): Promise<TaskWatcher[]> {
  const { data, error } = await supabase
    .from("task_watchers")
    .select("user_id, added_at, user:users!user_id(full_name)")
    .eq("task_id", taskId)
    .order("added_at", { ascending: true });

  if (error) throw new Error(`listTaskWatchers failed: ${error.message}`);
  return (data as unknown as TaskWatcherRow[]).map((row) => ({
    userId: row.user_id,
    fullName: row.user?.full_name ?? "Unknown",
    addedAt: row.added_at,
  }));
}

// Idempotent by design (ignoreDuplicates against task_watchers' own (task_id, user_id) primary
// key) - both the automatic triggers (task creation/reassignment/an @mention, M4.9's own explicit
// decision) and the manual add-watcher action can legitimately target someone already watching
// (e.g. mentioning the same person twice, or a task's assignee being @mentioned in their own
// task's comment thread), and that must stay a harmless no-op, not a thrown unique-violation.
export async function insertTaskWatcher(supabase: SupabaseClient, taskId: string, userId: string, addedBy: string): Promise<void> {
  const { error } = await supabase
    .from("task_watchers")
    .upsert({ task_id: taskId, user_id: userId, added_by: addedBy }, { onConflict: "task_id,user_id", ignoreDuplicates: true });

  if (error) throw new Error(`insertTaskWatcher failed: ${error.message}`);
}
