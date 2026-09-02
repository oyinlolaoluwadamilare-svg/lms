"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSessionActor } from "@/services/actor";
import { setStageBottleneckThreshold } from "@/services/pipelineStages";

export type SetStageBottleneckThresholdActionResult = { ok: true } | { ok: false; message: string };

// Empty string clears the threshold back to null (the stage is simply never flagged), not an
// invalid input - the same "unset is a real, meaningful state, not an error" reasoning this
// codebase's other optional-numeric-field schemas already use.
const schema = z.object({
  stageId: z.string().uuid(),
  thresholdDays: z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (value === "") return null;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Must be at least 1 day" });
        return z.NEVER;
      }
      return parsed;
    }),
});

export async function setStageBottleneckThresholdAction(input: {
  stageId: string;
  thresholdDays: string;
}): Promise<SetStageBottleneckThresholdActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };

  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  if (session.status !== "active") return { ok: false, message: "Your session has expired. Sign in again." };

  const result = await setStageBottleneckThreshold(supabase, session.actor, parsed.data.stageId, parsed.data.thresholdDays);
  if (result.ok) return { ok: true };
  return { ok: false, message: "You don't have permission to manage pipeline stages." };
}
