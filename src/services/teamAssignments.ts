import type { SupabaseClient } from "@supabase/supabase-js";
import { can, type Actor } from "@/auth/permissions";
import { listTeamAssignments, updateTeamAssignmentManager, type TeamAssignmentRow } from "@/data/teamAssignments";
import { listTeamMembersForPractice } from "@/data/users";
import { writeAudit } from "@/services/audit";

// Re-exported so app/(app)/admin/team-assignments only needs to import from this module - app may
// not import src/data directly (eslint.config.mjs boundaries).
export type { TeamAssignmentRow };

// M6.5 (docs/07-build-backlog.md): "Engagement analytics... all role-scoped." Migration 0021's own
// header comment explains why this exists: docs/04-metric-definitions.md's "Engagement coverage" is
// the first metric whose own text needs a "team" narrower than "practice," and nothing in this
// schema distinguished them before now. Gated on admin.assign_role (docs/02-permission-matrix.md,
// tenant_admin-only, scaffolded since M0.4 with no real caller until this milestone) - the same
// "narrower than what RLS alone would allow, checked explicitly" shape src/services/
// pipelineStages.ts's own header comment already established for its sibling admin screen.

export interface TeamLeadOption {
  id: string;
  fullName: string;
  practiceLineId: string;
}

export interface GetTeamAssignmentsResult {
  ok: true;
  assignments: TeamAssignmentRow[];
  teamLeadsByPracticeLineId: Record<string, TeamLeadOption[]>;
}
export type GetTeamAssignmentsFailure = { ok: false; code: "denied" };

export async function getTeamAssignments(supabase: SupabaseClient, actor: Actor): Promise<GetTeamAssignmentsResult | GetTeamAssignmentsFailure> {
  if (!can(actor, "admin.assign_role")) return { ok: false, code: "denied" };

  const assignments = await listTeamAssignments(supabase, actor.tenantId);

  const practiceLineIds = [...new Set(assignments.map((a) => a.practiceLineId))];
  const membersByPractice = await Promise.all(practiceLineIds.map((id) => listTeamMembersForPractice(supabase, actor.tenantId, id)));

  const teamLeadsByPracticeLineId: Record<string, TeamLeadOption[]> = {};
  practiceLineIds.forEach((practiceLineId, index) => {
    teamLeadsByPracticeLineId[practiceLineId] = membersByPractice[index]!
      .filter((member) => member.role === "team_lead")
      .map((member) => ({ id: member.id, fullName: member.fullName, practiceLineId }));
  });

  return { ok: true, assignments, teamLeadsByPracticeLineId };
}

export type SetTeamAssignmentManagerResult = { ok: true } | { ok: false; code: "denied" };

export async function setTeamAssignmentManager(
  supabase: SupabaseClient,
  actor: Actor,
  userRoleId: string,
  managerId: string | null,
): Promise<SetTeamAssignmentManagerResult> {
  if (!can(actor, "admin.assign_role")) return { ok: false, code: "denied" };

  await updateTeamAssignmentManager(supabase, userRoleId, managerId);

  await writeAudit({
    tenantId: actor.tenantId,
    actorId: actor.id,
    entityType: "user_roles",
    entityId: userRoleId,
    action: "admin.assign_role",
    after: { managerId },
  });

  return { ok: true };
}
