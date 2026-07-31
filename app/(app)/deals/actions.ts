"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionActor } from "@/services/actor";
import { changeStage } from "@/services/deals";

export type ChangeStageActionResult = { ok: true } | { ok: false; message: string };

// The board's only way to move a deal between columns - calls services/deals.ts's changeStage, the
// single path (docs/03-architecture.md). Returns a discriminated result rather than throwing or
// redirecting: the board is a client component doing an optimistic update, and needs a plain value
// to decide whether to keep the move or roll it back (docs/06-ui-spec.md: "rolling back visibly on
// failure").
export async function changeStageAction(dealId: string, toStageId: string): Promise<ChangeStageActionResult> {
  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  if (session.status !== "active") {
    return { ok: false, message: "Your session has expired. Sign in again." };
  }

  const result = await changeStage(supabase, session.actor, dealId, toStageId);
  if (result.ok) return { ok: true };

  switch (result.code) {
    case "denied":
      return { ok: false, message: "You don't have permission to move this deal." };
    case "same_stage":
      return { ok: false, message: "That deal is already in this stage." };
    case "target_is_closing_stage":
      return { ok: false, message: "Moving a deal to a won/lost stage isn't available yet - use Mark Won or Mark Lost when they land." };
    case "not_found":
      return { ok: false, message: "That deal or stage could not be found." };
  }
}
