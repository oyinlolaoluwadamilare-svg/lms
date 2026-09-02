"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSessionActor } from "@/services/actor";
import { setTeamAssignmentManager } from "@/services/teamAssignments";

export type SetTeamAssignmentManagerActionResult = { ok: true } | { ok: false; message: string };

// Empty string clears the manager back to null - a real, meaningful "unassigned" state, not an
// error, the same convention app/(app)/admin/pipeline-stages/actions.ts's own schema already uses
// for clearing a bottleneck threshold.
const schema = z.object({
  userRoleId: z.string().uuid(),
  managerId: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .pipe(z.string().uuid().nullable()),
});

export async function setTeamAssignmentManagerAction(input: {
  userRoleId: string;
  managerId: string;
}): Promise<SetTeamAssignmentManagerActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };

  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  if (session.status !== "active") return { ok: false, message: "Your session has expired. Sign in again." };

  const result = await setTeamAssignmentManager(supabase, session.actor, parsed.data.userRoleId, parsed.data.managerId);
  if (result.ok) return { ok: true };
  return { ok: false, message: "You don't have permission to manage team assignments." };
}
