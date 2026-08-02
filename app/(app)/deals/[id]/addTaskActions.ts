"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionActor } from "@/services/actor";
import { createTask } from "@/services/tasks";
import { addTaskSchema } from "./addTaskSchema";

export type AddTaskActionResult = { ok: true; taskId: string } | { ok: false; message: string };

// Called directly from AddTaskModal.tsx (a client component), the same plain-arguments server-action
// shape logActivityAction already established - no FormData, no useActionState/redirect, since the
// caller needs a plain result to decide whether to close the modal or show an inline error and keep
// it open.
export async function addTaskAction(
  dealId: string,
  originActivityId: string | null,
  input: { title: string; description: string; assigneeId: string; dueDate: string; priority: string },
): Promise<AddTaskActionResult> {
  const parsed = addTaskSchema.safeParse({
    title: input.title,
    description: input.description || undefined,
    assigneeId: input.assigneeId,
    dueDate: input.dueDate,
    priority: input.priority,
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  if (session.status !== "active") {
    return { ok: false, message: "Your session has expired. Sign in again." };
  }

  const result = await createTask(supabase, session.actor, {
    dealId,
    originActivityId,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    assigneeId: parsed.data.assigneeId,
    dueDate: parsed.data.dueDate,
    priority: parsed.data.priority,
  });

  if (!result.ok) {
    switch (result.code) {
      case "denied":
        return { ok: false, message: "You don't have permission to add a task on this deal." };
      case "not_found":
        return { ok: false, message: "That deal could not be found." };
      case "invalid_assignee":
        return { ok: false, message: "Choose a valid assignee." };
    }
  }

  return { ok: true, taskId: result.task.id };
}
