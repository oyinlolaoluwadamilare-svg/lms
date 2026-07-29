"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionActor } from "@/services/actor";
import { createDeal } from "@/services/deals";
import { toMinorUnits } from "@/domain/money";
import { createDealSchema } from "./schema";

export type CreateDealState = { ok: false; message: string } | null;

// Currency is hardcoded pending docs/DECISIONS.md D-08b (which currencies a tenant may use is
// still an open question) - not a form field, so there is nothing for a caller to set it to.
const CURRENCY_CODE = "NGN";

export async function createDealAction(_prevState: CreateDealState, formData: FormData): Promise<CreateDealState> {
  const parsed = createDealSchema.safeParse({
    name: formData.get("name"),
    accountId: formData.get("accountId"),
    practiceLineId: formData.get("practiceLineId"),
    stageId: formData.get("stageId"),
    clientType: formData.get("clientType"),
    ownerId: formData.get("ownerId"),
    expectedCloseDate: formData.get("expectedCloseDate"),
    proposalValue: formData.get("proposalValue") || undefined,
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

  const result = await createDeal(supabase, session.actor, {
    name: parsed.data.name,
    accountId: parsed.data.accountId,
    practiceLineId: parsed.data.practiceLineId,
    stageId: parsed.data.stageId,
    clientType: parsed.data.clientType,
    ownerId: parsed.data.ownerId,
    expectedCloseDate: parsed.data.expectedCloseDate,
    proposalValueMinor: parsed.data.proposalValue ? toMinorUnits(parsed.data.proposalValue) : null,
    currencyCode: CURRENCY_CODE,
    brief: parsed.data.brief ?? null,
  });

  if (!result.ok) {
    if (result.code === "denied") {
      return { ok: false, message: "You don't have permission to create a deal in that practice line." };
    }
    return { ok: false, message: "Could not generate a unique deal reference. Try again." };
  }

  redirect("/deals");
}
