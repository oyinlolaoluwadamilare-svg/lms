"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSessionActor } from "@/services/actor";
import { assignTask, completeTask, getReassignContext, snoozeTask, type AssignableUser } from "@/services/tasks";

export type CompleteTaskActionResult = { ok: true } | { ok: false; message: string };

// docs/07-build-backlog.md M4.5's "inline complete" - plain-arguments server action, the same shape
// every other client-driven action in this codebase already established (logActivityAction,
// addTaskAction).
export async function completeTaskAction(taskId: string): Promise<CompleteTaskActionResult> {
  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  if (session.status !== "active") return { ok: false, message: "Your session has expired. Sign in again." };

  const result = await completeTask(supabase, session.actor, taskId);
  if (result.ok) return { ok: true };

  switch (result.code) {
    case "not_found":
      return { ok: false, message: "That task could not be found." };
    case "denied":
      return { ok: false, message: "You don't have permission to complete this task." };
    case "already_done":
      return { ok: false, message: "This task is already done." };
    case "cancelled":
      return { ok: false, message: "A cancelled task can't be completed." };
  }
}

const snoozeSchema = z.object({
  newDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date"),
  reason: z.string().trim().optional(),
});

export type SnoozeTaskActionResult = { ok: true } | { ok: false; message: string };

export async function snoozeTaskAction(taskId: string, input: { newDueDate: string; reason: string }): Promise<SnoozeTaskActionResult> {
  const parsed = snoozeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };

  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  if (session.status !== "active") return { ok: false, message: "Your session has expired. Sign in again." };

  const result = await snoozeTask(supabase, session.actor, taskId, parsed.data.newDueDate, parsed.data.reason ?? null);
  if (result.ok) return { ok: true };

  switch (result.code) {
    case "not_found":
      return { ok: false, message: "That task could not be found." };
    case "denied":
      return { ok: false, message: "You don't have permission to snooze this task." };
    case "already_done":
      return { ok: false, message: "A completed task can't be snoozed." };
    case "cancelled":
      return { ok: false, message: "A cancelled task can't be snoozed." };
    case "must_be_later":
      return { ok: false, message: "Pick a date after the task's current due date." };
    case "reason_required":
      return { ok: false, message: "A reason is required after two snoozes." };
  }
}

export type ReassignContextActionResult = { ok: true; assignableUsers: AssignableUser[] } | { ok: false; message: string };

// Fetched on demand when a My Work row's own "Reassign" control opens - src/services/tasks.ts's
// getReassignContext own comment explains why this can't be pre-fetched for the whole page (many
// different deals/practices in one queue).
export async function getReassignContextAction(taskId: string): Promise<ReassignContextActionResult> {
  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  if (session.status !== "active") return { ok: false, message: "Your session has expired. Sign in again." };

  const context = await getReassignContext(supabase, session.actor, taskId);
  if (!context.canReassign) return { ok: false, message: "You don't have permission to reassign this task." };
  return { ok: true, assignableUsers: context.assignableUsers };
}

export type ReassignTaskActionResult = { ok: true } | { ok: false; message: string };

export async function reassignTaskAction(taskId: string, newAssigneeId: string): Promise<ReassignTaskActionResult> {
  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  if (session.status !== "active") return { ok: false, message: "Your session has expired. Sign in again." };

  const result = await assignTask(supabase, session.actor, taskId, newAssigneeId);
  if (result.ok) return { ok: true };

  switch (result.code) {
    case "not_found":
      return { ok: false, message: "That task could not be found." };
    case "denied":
      return { ok: false, message: "You don't have permission to reassign this task." };
    case "same_assignee":
      return { ok: false, message: "That's already who this task is assigned to." };
    case "invalid_assignee":
      return { ok: false, message: "Choose a valid assignee." };
  }
}
