"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSessionActor } from "@/services/actor";
import { createOutcomeReason, setOutcomeReasonActiveStatus } from "@/services/outcomeReasons";

export type CreateOutcomeReasonActionResult = { ok: true } | { ok: false; message: string };

const createSchema = z.object({
  type: z.enum(["win", "loss"]),
  label: z.string().trim().min(1, "A label is required"),
  sortOrder: z.coerce.number().int().min(0),
});

export async function createOutcomeReasonAction(input: {
  type: string;
  label: string;
  sortOrder: string;
}): Promise<CreateOutcomeReasonActionResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };

  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  if (session.status !== "active") return { ok: false, message: "Your session has expired. Sign in again." };

  const result = await createOutcomeReason(supabase, session.actor, parsed.data);
  if (result.ok) return { ok: true };
  return { ok: false, message: "You don't have permission to manage outcome reasons." };
}

export type SetOutcomeReasonActiveActionResult = { ok: true } | { ok: false; message: string };

export async function setOutcomeReasonActiveAction(id: string, isActive: boolean): Promise<SetOutcomeReasonActiveActionResult> {
  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  if (session.status !== "active") return { ok: false, message: "Your session has expired. Sign in again." };

  const result = await setOutcomeReasonActiveStatus(supabase, session.actor, id, isActive);
  if (result.ok) return { ok: true };
  return { ok: false, message: "You don't have permission to manage outcome reasons." };
}
