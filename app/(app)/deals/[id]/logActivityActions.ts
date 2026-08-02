"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionActor } from "@/services/actor";
import { logActivity } from "@/services/activities";
import { logActivitySchema } from "./logActivitySchema";

export type LogActivityActionResult = { ok: true } | { ok: false; message: string };

// Called directly from LogActivityModal.tsx (a client component), the same plain-arguments
// server-action shape app/(app)/deals/actions.ts's changeStageAction already established for a
// client-driven interaction that isn't a full-page form submission - no FormData, no
// useActionState/redirect, since the caller needs a plain result to decide whether to close the
// modal or show an inline error and keep it open.
export async function logActivityAction(
  dealId: string,
  input: { type: string; activityDate: string; summary: string; outcome: string; outcomeDisposition: string },
): Promise<LogActivityActionResult> {
  const parsed = logActivitySchema.safeParse({
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

  const result = await logActivity(supabase, session.actor, session.timezone, {
    dealId,
    type: parsed.data.type,
    activityDate: parsed.data.activityDate,
    summary: parsed.data.summary,
    outcome: parsed.data.outcome ?? null,
    outcomeDisposition: parsed.data.outcomeDisposition ?? null,
  });

  if (result.ok) return { ok: true };

  switch (result.code) {
    case "denied":
      return { ok: false, message: "You don't have permission to log an activity on this deal." };
    case "not_found":
      return { ok: false, message: "That deal could not be found." };
    case "activity_date_in_future":
      // Verbatim per docs/06-ui-spec.md's own inline-error copy.
      return { ok: false, message: "future intent is a task, not an engagement" };
  }
}
