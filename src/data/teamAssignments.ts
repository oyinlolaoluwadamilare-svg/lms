import type { SupabaseClient } from "@supabase/supabase-js";

export interface TeamAssignmentRow {
  userRoleId: string;
  userId: string;
  fullName: string;
  email: string;
  practiceLineId: string;
  practiceLineName: string;
  managerId: string | null;
  managerName: string | null;
}

interface TeamAssignmentRawRow {
  id: string;
  practice_line_id: string;
  manager_id: string | null;
  practice_lines: { name: string } | null;
  bde: { id: string; full_name: string; email: string; status: string; deleted_at: string | null } | null;
  manager: { full_name: string } | null;
}

// M6.5 (docs/07-build-backlog.md): "Engagement analytics... all role-scoped." The `/admin/
// team-assignments` screen's own read - every active bde-role grant in the tenant, with its current
// manager (if any) and practice line, so a tenant_admin can see and edit the whole roster in one
// place rather than practice by practice. Scoped to `role = 'bde'` only: migration 0021's own
// validate_user_roles_manager() trigger only ever validates a manager against an active team_lead,
// and this screen is the only place manager_id is set today - a team_lead's own manager_id (were one
// ever set, e.g. reporting to a director) has no behavioural effect yet and isn't shown here.
export async function listTeamAssignments(supabase: SupabaseClient, tenantId: string): Promise<TeamAssignmentRow[]> {
  const { data, error } = await supabase
    .from("user_roles")
    .select(
      "id, practice_line_id, manager_id, practice_lines(name), " +
        "bde:users!user_id(id, full_name, email, status, deleted_at), " +
        "manager:users!manager_id(full_name)",
    )
    .eq("tenant_id", tenantId)
    .eq("role", "bde")
    .is("revoked_at", null);

  if (error) throw new Error(`listTeamAssignments failed: ${error.message}`);

  return (data as unknown as TeamAssignmentRawRow[])
    .filter((row) => row.bde && row.bde.status === "active" && row.bde.deleted_at === null)
    .map((row) => ({
      userRoleId: row.id,
      userId: row.bde!.id,
      fullName: row.bde!.full_name,
      email: row.bde!.email,
      practiceLineId: row.practice_line_id,
      practiceLineName: row.practice_lines?.name ?? "Unknown practice",
      managerId: row.manager_id,
      managerName: row.manager?.full_name ?? null,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

// Writes through the caller's own RLS-scoped session, never a service-role client - migration
// 0003's user_roles_update policy (tenant_admin-only) is the real backstop, the same "RLS is a
// second, independent control" reasoning src/data/pipelineStages.ts's own updateStageBottleneckThreshold
// comment gives for its sibling admin screen. migration 0021's own trigger is the non-bypassable
// backstop proving the chosen manager is actually an active team_lead in the same tenant/practice -
// src/services/teamAssignments.ts's own can() gate is the friendly layer in front of both.
export async function updateTeamAssignmentManager(supabase: SupabaseClient, userRoleId: string, managerId: string | null): Promise<void> {
  const { error } = await supabase.from("user_roles").update({ manager_id: managerId }).eq("id", userRoleId);
  if (error) throw new Error(`updateTeamAssignmentManager failed: ${error.message}`);
}
