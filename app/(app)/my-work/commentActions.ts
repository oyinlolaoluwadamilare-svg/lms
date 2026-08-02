"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSessionActor } from "@/services/actor";
import { addWatcher, createTaskComment, getTaskCommentsContext, resolveTaskComment, type TaskCommentsContext } from "@/services/taskComments";

// M4.9 (docs/07-build-backlog.md): "Comments, watchers and @mention with an in-scope user picker."
// Same plain-arguments server-action shape every other client-driven action in this codebase
// already established (completeTaskAction, addTaskAction, reassignTaskAction, ...).

export type GetTaskCommentsContextActionResult = { ok: true; context: TaskCommentsContext } | { ok: false; message: string };

export async function getTaskCommentsContextAction(taskId: string): Promise<GetTaskCommentsContextActionResult> {
  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  if (session.status !== "active") return { ok: false, message: "Your session has expired. Sign in again." };

  const context = await getTaskCommentsContext(supabase, session.actor, taskId);
  if (!context) return { ok: false, message: "That task could not be found." };
  return { ok: true, context };
}

const commentSchema = z.object({
  body: z.string().trim().min(1, "A comment can't be empty"),
  mentionedUserIds: z.array(z.string()),
});

export type CreateTaskCommentActionResult = { ok: true } | { ok: false; message: string };

export async function createTaskCommentAction(
  taskId: string,
  input: { body: string; mentionedUserIds: string[] },
): Promise<CreateTaskCommentActionResult> {
  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };

  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  if (session.status !== "active") return { ok: false, message: "Your session has expired. Sign in again." };

  const result = await createTaskComment(supabase, session.actor, taskId, parsed.data.body, parsed.data.mentionedUserIds);
  if (result.ok) return { ok: true };

  switch (result.code) {
    case "not_found":
      return { ok: false, message: "That task could not be found." };
    case "denied":
      return { ok: false, message: "You don't have permission to comment on this task." };
    case "invalid_mention":
      return { ok: false, message: "Choose a mention from the list offered." };
  }
}

export type ResolveTaskCommentActionResult = { ok: true } | { ok: false; message: string };

export async function resolveTaskCommentAction(commentId: string, resolved: boolean): Promise<ResolveTaskCommentActionResult> {
  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  if (session.status !== "active") return { ok: false, message: "Your session has expired. Sign in again." };

  const result = await resolveTaskComment(supabase, session.actor, commentId, resolved);
  if (result.ok) return { ok: true };

  switch (result.code) {
    case "not_found":
      return { ok: false, message: "That comment could not be found." };
    case "denied":
      return { ok: false, message: "You don't have permission to resolve this comment." };
  }
}

export type AddWatcherActionResult = { ok: true } | { ok: false; message: string };

export async function addWatcherAction(taskId: string, userId: string): Promise<AddWatcherActionResult> {
  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  if (session.status !== "active") return { ok: false, message: "Your session has expired. Sign in again." };

  const result = await addWatcher(supabase, session.actor, taskId, userId);
  if (result.ok) return { ok: true };

  switch (result.code) {
    case "not_found":
      return { ok: false, message: "That task could not be found." };
    case "denied":
      return { ok: false, message: "You don't have permission to add that watcher." };
    case "invalid_watcher":
      return { ok: false, message: "Choose a watcher from the list offered." };
  }
}
