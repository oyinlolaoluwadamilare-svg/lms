"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionActor } from "@/services/actor";
import { closeDeal } from "@/services/deals";
import { toMinorUnits } from "@/domain/money";
import { markWonSchema } from "./markWonSchema";

export type MarkWonActionResult = { ok: true } | { ok: false; message: string };

// Same plain-arguments server-action shape app/(app)/deals/actions.ts's changeStageAction and this
// directory's logActivityAction/addTaskAction already established for a client-driven modal
// interaction: no FormData, no useActionState/redirect, since the caller (MarkWonModal.tsx) needs a
// plain result to decide whether to close the dialog or show an inline error and keep it open.
//
// currencyCode is never user-entered - there is no currency picker anywhere in this codebase (see
// src/domain/money.ts's own conventions), so pairing finalValueMinor with the deal's own existing
// currencyCode (passed in by the caller, sourced from getDealForEditView) is what satisfies
// migration 0016's `final_value_needs_currency` check constraint (both null or both set) without
// ever needing a currency-selection UI nothing in the backlog asks for. When the amount field was
// left blank, both are sent as null - the same "either both or neither" pairing, just at the other
// value.
export async function markDealWonAction(
  dealId: string,
  input: { reasonId: string; finalValue: string; actualCloseDate: string; currencyCode: string },
): Promise<MarkWonActionResult> {
  const parsed = markWonSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  if (session.status !== "active") {
    return { ok: false, message: "Your session has expired. Sign in again." };
  }

  const finalValueMinor = parsed.data.finalValue ? toMinorUnits(parsed.data.finalValue) : null;

  const result = await closeDeal(supabase, session.actor, dealId, {
    result: "win",
    reasonId: parsed.data.reasonId,
    reasonDetail: null,
    competitorName: null,
    finalValueMinor,
    currencyCode: finalValueMinor === null ? null : input.currencyCode,
    actualCloseDate: parsed.data.actualCloseDate,
  });

  if (result.ok) return { ok: true };

  switch (result.code) {
    case "denied":
      return { ok: false, message: "You don't have permission to mark this deal won." };
    case "not_found":
      return { ok: false, message: "That deal could not be found." };
    case "already_closed":
      return { ok: false, message: "This deal has already been closed." };
    case "reason_not_found":
      return { ok: false, message: "That reason could not be found." };
    case "reason_type_mismatch":
      return { ok: false, message: "That reason isn't a win reason." };
    case "loss_requires_detail":
    case "competitor_name_required":
      // Structurally unreachable from this action: result is always "win" here, and both codes are
      // closeDeal's own loss-only checks. Handled anyway rather than asserted away, the same
      // defensive-but-honest shape describeAttachError's own comment (logActivityActions.ts) uses
      // for its own structurally-unreachable branches.
      return { ok: false, message: "This deal could not be marked won." };
  }
}
