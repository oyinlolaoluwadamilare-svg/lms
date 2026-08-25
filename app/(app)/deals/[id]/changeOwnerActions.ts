"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionActor } from "@/services/actor";
import { changeDealOwner } from "@/services/deals";
import type { HandoverSummary } from "@/services/handover";
import { changeOwnerSchema } from "./changeOwnerSchema";

export type ChangeOwnerActionResult = { ok: true; handover: HandoverSummary } | { ok: false; message: string };

// Same plain-arguments server-action shape this directory's markDealWonAction/logActivityAction
// already established for a client-driven modal interaction - a plain result the modal uses to
// decide whether to move to its own "handover summary" step or show an inline error and stay put.
export async function changeDealOwnerAction(dealId: string, input: { newOwnerId: string }): Promise<ChangeOwnerActionResult> {
  const parsed = changeOwnerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  if (session.status !== "active") {
    return { ok: false, message: "Your session has expired. Sign in again." };
  }

  const result = await changeDealOwner(supabase, session.actor, dealId, parsed.data.newOwnerId);
  if (result.ok) return { ok: true, handover: result.handover };

  switch (result.code) {
    case "denied":
      return { ok: false, message: "You don't have permission to change this deal's owner." };
    case "not_found":
      return { ok: false, message: "That deal could not be found." };
    case "same_owner":
      return { ok: false, message: "That person already owns this deal." };
    case "invalid_owner":
      return { ok: false, message: "That person isn't eligible to own this deal." };
  }
}
