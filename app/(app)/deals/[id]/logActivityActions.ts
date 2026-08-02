"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionActor } from "@/services/actor";
import { logActivity } from "@/services/activities";
import { attachDocumentToActivity } from "@/services/documents";
import { logActivitySchema } from "./logActivitySchema";

// attachmentWarning: the activity itself always saves independently of any attachment outcome -
// M3.8's own upload/insert ordering already disclosed the gap that these are separate, non-atomic
// writes (src/services/documents.ts's own comment). A failed attachment (too large, wrong type,
// etc.) is surfaced back to the modal as a warning on an otherwise-successful save, never silently
// dropped and never treated as if the whole log-activity action failed.
export type LogActivityActionResult = { ok: true; attachmentWarning?: string } | { ok: false; message: string };

function describeAttachError(fileName: string, code: "not_found" | "denied" | "retracted" | "too_large" | "type_not_allowed"): string {
  switch (code) {
    case "too_large":
      return `${fileName}: file is too large`;
    case "type_not_allowed":
      return `${fileName}: file type not allowed`;
    case "denied":
    case "not_found":
    case "retracted":
      // Structurally unreachable from this action: the activity was just created by this same
      // actor in this same call, so it always exists, is never retracted, and this actor always
      // has attach_file rights identical to the create rights that just succeeded. Handled anyway
      // rather than asserted away, the same defensive-but-honest shape every exhaustive switch in
      // this codebase already uses.
      return `${fileName}: could not be attached`;
  }
}

// Called directly from LogActivityModal.tsx (a client component), the same plain-arguments
// server-action shape app/(app)/deals/actions.ts's changeStageAction already established for a
// client-driven interaction that isn't a full-page form submission - no FormData, no
// useActionState/redirect, since the caller needs a plain result to decide whether to close the
// modal or show an inline error and keep it open. `files` is passed as a plain File[] argument (not
// wrapped in FormData) - Next.js Server Actions serialise File objects directly, the same as any
// other supported argument type.
export async function logActivityAction(
  dealId: string,
  input: { type: string; activityDate: string; summary: string; outcome: string; outcomeDisposition: string },
  files: File[],
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

  if (!result.ok) {
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

  const attachmentErrors: string[] = [];
  for (const file of files) {
    const attachResult = await attachDocumentToActivity(supabase, session.actor, result.activity.id, {
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      bytes: await file.arrayBuffer(),
    });
    if (!attachResult.ok) {
      attachmentErrors.push(describeAttachError(file.name, attachResult.code));
    }
  }

  if (attachmentErrors.length > 0) {
    return { ok: true, attachmentWarning: `Activity saved, but: ${attachmentErrors.join("; ")}` };
  }
  return { ok: true };
}
