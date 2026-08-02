"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionActor } from "@/services/actor";
import { updateDeal } from "@/services/deals";
import { toMinorUnits } from "@/domain/money";
import { editDealSchema } from "./schema";

export type EditDealState = { ok: false; message: string } | null;

export async function editDealAction(
  dealId: string,
  _prevState: EditDealState,
  formData: FormData,
): Promise<EditDealState> {
  const parsed = editDealSchema.safeParse({
    name: formData.get("name"),
    clientType: formData.get("clientType"),
    expectedCloseDate: formData.get("expectedCloseDate"),
    proposalValue: formData.get("proposalValue") || undefined,
    negotiatedValue: formData.get("negotiatedValue") || undefined,
    brief: formData.get("brief") || undefined,
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  if (session.status !== "active") {
    redirect("/sign-in");
  }

  const result = await updateDeal(supabase, session.actor, dealId, {
    name: parsed.data.name,
    clientType: parsed.data.clientType,
    expectedCloseDate: parsed.data.expectedCloseDate,
    proposalValueMinor: parsed.data.proposalValue ? toMinorUnits(parsed.data.proposalValue) : null,
    negotiatedValueMinor: parsed.data.negotiatedValue ? toMinorUnits(parsed.data.negotiatedValue) : null,
    brief: parsed.data.brief ?? null,
  });

  if (!result.ok) {
    if (result.code === "denied") {
      return { ok: false, message: "You don't have permission to edit this deal." };
    }
    return { ok: false, message: "That deal could not be found." };
  }

  redirect(`/deals/${dealId}`);
}
