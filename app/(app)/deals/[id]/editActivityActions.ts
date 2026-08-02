"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionActor } from "@/services/actor";
import { updateActivity, retractActivity } from "@/services/activities";
import { editActivitySchema } from "./editActivitySchema";

export type EditActivityActionResult = { ok: true } | { ok: false; message: string };

// Mirrors logActivityAction's plain-arguments shape (src/app/(app)/deals/[id]/logActivityActions.ts)
// for the same reason: the caller (EditActivityModal, a client component) needs a plain result to
// decide whether to close the modal or show an inline error and keep it open.
export async function editActivityAction(
  activityId: string,
  input: { type: string; activityDate: string; summary: string; outcome: string; outcomeDisposition: string },
): Promise<EditActivityActionResult> {
  const parsed = editActivitySchema.safeParse({
    type: input.type,
    activityDate: input.activityDate,
    summary: input.summary,
    outcome: input.outcome || undefined,
    outcomeDisposition: input.outcomeDisposition || undefined,
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  if (session.status !== "active") {
    return { ok: false, message: "Your session has expired. Sign in again." };
  }

  const result = await updateActivity(supabase, session.actor, activityId, {
    type: parsed.data.type,
    activityDate: parsed.data.activityDate,
    summary: parsed.data.summary,
    outcome: parsed.data.outcome ?? null,
    outcomeDisposition: parsed.data.outcomeDisposition ?? null,
  });

  if (result.ok) return { ok: true };

  switch (result.code) {
    case "denied":
      return { ok: false, message: "You can only edit your own activities." };
    case "not_found":
      return { ok: false, message: "That activity could not be found." };
    case "retracted":
      return { ok: false, message: "A retracted activity can't be edited." };
    case "edit_window_expired":
      return { ok: false, message: "The 24-hour edit window for this activity has passed." };
  }
}

export type RetractActivityActionResult = { ok: true } | { ok: false; message: string };

// Same plain-arguments shape - the RetractActivityModal needs a plain result too, and the mandatory
// reason (docs/07-build-backlog.md M3.6) is the one required field.
export async function retractActivityAction(activityId: string, reason: string): Promise<RetractActivityActionResult> {
  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  if (session.status !== "active") {
    return { ok: false, message: "Your session has expired. Sign in again." };
  }

  const result = await retractActivity(supabase, session.actor, activityId, reason);
  if (result.ok) return { ok: true };

  switch (result.code) {
    case "denied":
      return { ok: false, message: "You don't have permission to retract this activity." };
    case "not_found":
      return { ok: false, message: "That activity could not be found." };
    case "already_retracted":
      return { ok: false, message: "This activity has already been retracted." };
    case "reason_required":
      return { ok: false, message: "A reason is required to retract an activity." };
  }
}
