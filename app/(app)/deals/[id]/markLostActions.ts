"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionActor } from "@/services/actor";
import { closeDeal } from "@/services/deals";
import { markLostSchema } from "./markLostSchema";

export type MarkLostActionResult = { ok: true } | { ok: false; message: string };

// Same plain-arguments server-action shape markWonActions.ts's markDealWonAction uses - see its own
// comment for the reasoning. A lost deal never records a final value or currency (deal_outcomes'
// final_value_minor stays null) - "final value" is a realised-revenue figure, which only exists for
// a won deal.
export async function markDealLostAction(
  dealId: string,
  input: { reasonId: string; reasonDetail: string; competitorName: string; actualCloseDate: string },
): Promise<MarkLostActionResult> {
  const parsed = markLostSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  if (session.status !== "active") {
    return { ok: false, message: "Your session has expired. Sign in again." };
  }

  const result = await closeDeal(supabase, session.actor, dealId, {
    result: "loss",
    reasonId: parsed.data.reasonId,
    reasonDetail: parsed.data.reasonDetail,
    competitorName: parsed.data.competitorName?.trim() || null,
    finalValueMinor: null,
    currencyCode: null,
    actualCloseDate: parsed.data.actualCloseDate,
  });

  if (result.ok) return { ok: true };

  switch (result.code) {
    case "denied":
      return { ok: false, message: "You don't have permission to mark this deal lost." };
    case "not_found":
      return { ok: false, message: "That deal could not be found." };
    case "already_closed":
      return { ok: false, message: "This deal has already been closed." };
    case "reason_not_found":
      return { ok: false, message: "That reason could not be found." };
    case "reason_type_mismatch":
      return { ok: false, message: "That reason isn't a loss reason." };
    case "loss_requires_detail":
      // Verbatim wording as markLostSchema's own client-side check - if this ever fires it means
      // the client-side check was bypassed (blank detail sent directly), so the message should
      // still read consistently rather than surprise the user with different copy.
      return { ok: false, message: "A loss requires a detail explaining why." };
    case "competitor_name_required":
      return { ok: false, message: "This reason requires a competitor name." };
  }
}
