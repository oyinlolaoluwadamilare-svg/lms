import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSessionActor } from "@/services/actor";
import { getTeamAssignments, setTeamAssignmentManager } from "@/services/teamAssignments";
import { findOrCreateByUniqueMatch, findOrCreateTenant, findOrCreateUser, signIn as signInAs } from "./support/permanentFixture";

// M6.5 exit criteria (docs/07-build-backlog.md): "Engagement analytics," which grew to include a
// real team concept and its own admin screen (docs/DECISIONS.md D-18). Proves the new
// /admin/team-assignments screen's own service layer end to end, against the real hosted project
// through real signed-in sessions: a tenant_admin can read the roster (including the practice's own
// team_lead options) and set/clear a bde's manager_id; migration 0021's own trigger rejects a
// manager_id that isn't an active team_lead in the same tenant/practice line; a bde is denied at the
// can() level for both - the same "narrower than what RLS alone would allow, proven at the service
// layer" shape tests/integration/pipeline-stages-admin.spec.ts already established for its own
// sibling admin screen, and tests/rls/foundation.spec.ts already proves the raw RLS/trigger layer
// separately.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M6-5-Integration-Test-Pw1!";

let service: SupabaseClient;

const ids = {
  tenantId: "",
  practiceLineId: "",
  adminAuthId: "",
  teamLeadAuthId: "",
  otherTeamLeadAuthId: "",
  bdeAuthId: "",
  bdeUserRoleId: "",
};

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

beforeAll(async () => {
  service = createServiceClient();

  ids.tenantId = await findOrCreateTenant(service, "m6-5-team-assignments-test", "M6.5 Team Assignments Test Tenant");
  ids.practiceLineId = await findOrCreateByUniqueMatch(
    service,
    "practice_lines",
    { tenant_id: ids.tenantId, code: "ADV" },
    { tenant_id: ids.tenantId, name: "Advisory", code: "ADV" },
  );

  ids.adminAuthId = await findOrCreateUser(service, ids.tenantId, "m6-5-ta-admin@example.com", "M6.5 TA Admin", PASSWORD);
  ids.teamLeadAuthId = await findOrCreateUser(service, ids.tenantId, "m6-5-ta-team-lead@example.com", "M6.5 TA Team Lead", PASSWORD);
  ids.otherTeamLeadAuthId = await findOrCreateUser(service, ids.tenantId, "m6-5-ta-other-team-lead@example.com", "M6.5 TA Other Team Lead", PASSWORD);
  ids.bdeAuthId = await findOrCreateUser(service, ids.tenantId, "m6-5-ta-bde@example.com", "M6.5 TA Bde", PASSWORD);

  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  const { error: roleError } = await service.from("user_roles").insert([
    { tenant_id: ids.tenantId, user_id: ids.adminAuthId, role: "tenant_admin", practice_line_id: null },
    { tenant_id: ids.tenantId, user_id: ids.teamLeadAuthId, role: "team_lead", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.otherTeamLeadAuthId, role: "team_lead", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.bdeAuthId, role: "bde", practice_line_id: ids.practiceLineId },
  ]);
  if (roleError) throw new Error(`fixture role grant failed: ${roleError.message}`);

  const { data: bdeRoleRow, error: bdeRoleError } = await service
    .from("user_roles")
    .select("id")
    .eq("tenant_id", ids.tenantId)
    .eq("user_id", ids.bdeAuthId)
    .eq("role", "bde")
    .single();
  if (bdeRoleError) throw new Error(`look up bde user_roles row failed: ${bdeRoleError.message}`);
  ids.bdeUserRoleId = bdeRoleRow.id;
});

afterAll(async () => {
  await service.from("user_roles").update({ manager_id: null }).eq("tenant_id", ids.tenantId);
});

describe("team assignments admin service, end to end against a real signed-in session", () => {
  it("a tenant_admin sees the roster with team_lead options for the practice, then sets and clears a bde's manager", async () => {
    const client = await signIn("m6-5-ta-admin@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const before = await getTeamAssignments(client, session.actor);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const bdeRow = before.assignments.find((a) => a.userRoleId === ids.bdeUserRoleId);
    expect(bdeRow?.managerId).toBeNull();
    const teamLeadOptions = before.teamLeadsByPracticeLineId[ids.practiceLineId]?.map((o) => o.id) ?? [];
    expect(teamLeadOptions).toEqual(expect.arrayContaining([ids.teamLeadAuthId, ids.otherTeamLeadAuthId]));

    const setResult = await setTeamAssignmentManager(client, session.actor, ids.bdeUserRoleId, ids.teamLeadAuthId);
    expect(setResult.ok).toBe(true);

    const afterSet = await getTeamAssignments(client, session.actor);
    expect(afterSet.ok).toBe(true);
    if (!afterSet.ok) return;
    expect(afterSet.assignments.find((a) => a.userRoleId === ids.bdeUserRoleId)?.managerId).toBe(ids.teamLeadAuthId);

    const clearResult = await setTeamAssignmentManager(client, session.actor, ids.bdeUserRoleId, null);
    expect(clearResult.ok).toBe(true);

    const afterClear = await getTeamAssignments(client, session.actor);
    expect(afterClear.ok).toBe(true);
    if (!afterClear.ok) return;
    expect(afterClear.assignments.find((a) => a.userRoleId === ids.bdeUserRoleId)?.managerId).toBeNull();
  });

  it("writes an audit row for each successful manager assignment", async () => {
    const client = await signIn("m6-5-ta-admin@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const { count: auditBefore } = await service
      .from("audit_entries")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "user_roles")
      .eq("entity_id", ids.bdeUserRoleId)
      .eq("action", "admin.assign_role");

    const result = await setTeamAssignmentManager(client, session.actor, ids.bdeUserRoleId, ids.otherTeamLeadAuthId);
    expect(result.ok).toBe(true);

    const { count: auditAfter } = await service
      .from("audit_entries")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "user_roles")
      .eq("entity_id", ids.bdeUserRoleId)
      .eq("action", "admin.assign_role");
    expect(auditAfter).toBe((auditBefore ?? 0) + 1);

    await setTeamAssignmentManager(client, session.actor, ids.bdeUserRoleId, null);
  });

  it("rejects a manager_id that isn't an active team_lead in the same tenant/practice line (migration 0021's trigger)", async () => {
    const client = await signIn("m6-5-ta-admin@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    await expect(setTeamAssignmentManager(client, session.actor, ids.bdeUserRoleId, ids.bdeAuthId)).rejects.toThrow(/is not an active team_lead/);

    const { data: row } = await service.from("user_roles").select("manager_id").eq("id", ids.bdeUserRoleId).single();
    expect(row?.manager_id).toBeNull();
  });

  it("a bde is denied at the can() level for both reading and writing", async () => {
    const client = await signIn("m6-5-ta-bde@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const listed = await getTeamAssignments(client, session.actor);
    expect(listed).toEqual({ ok: false, code: "denied" });

    const written = await setTeamAssignmentManager(client, session.actor, ids.bdeUserRoleId, ids.teamLeadAuthId);
    expect(written).toEqual({ ok: false, code: "denied" });

    const { data: row } = await service.from("user_roles").select("manager_id").eq("id", ids.bdeUserRoleId).single();
    expect(row?.manager_id).toBeNull();
  });
});
