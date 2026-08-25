"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionActor } from "@/services/actor";
import { reassignAccountPracticeOwner } from "@/services/accounts";
import type { HandoverSummary } from "@/services/handover";
import { reassignOwnerSchema } from "./reassignOwnerSchema";

export type ReassignOwnerActionResult = { ok: true; handover: HandoverSummary } | { ok: false; message: string };

// Same plain-arguments server-action shape this codebase's other owner-change action
// (app/(app)/deals/[id]/changeOwnerActions.ts) already established.
export async function reassignAccountPracticeOwnerAction(
  accountId: string,
  input: { practiceLineId: string; newOwnerId: string },
): Promise<ReassignOwnerActionResult> {
  const parsed = reassignOwnerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  if (session.status !== "active") {
    return { ok: false, message: "Your session has expired. Sign in again." };
  }

  const result = await reassignAccountPracticeOwner(
    supabase,
    session.actor,
    accountId,
    parsed.data.practiceLineId,
    parsed.data.newOwnerId,
    session.timezone,
  );
  if (result.ok) return { ok: true, handover: result.handover };

  switch (result.code) {
    case "denied":
      return { ok: false, message: "You don't have permission to reassign this practice line's owner." };
    case "not_found":
      return { ok: false, message: "That account or practice-line relationship could not be found." };
    case "same_owner":
      return { ok: false, message: "That person already owns this relationship." };
    case "invalid_owner":
      return { ok: false, message: "That person isn't eligible to own this relationship." };
  }
}
