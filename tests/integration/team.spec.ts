import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSessionActor } from "@/services/actor";
import { completeTask, createTask, getTeamOverview } from "@/services/tasks";
import { findOrCreateByUniqueMatch, findOrCreateTenant, findOrCreateUser, signIn as signInAs } from "./support/permanentFixture";

// M4.6 exit criteria (docs/07-build-backlog.md): "Team view for Team Lead and Director with
// per-person open, overdue and completed counts." Exercises getTeamOverview end to end against the
// real hosted project, through the real createTask/completeTask services.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M4-6-Integration-Test-Pw1!";

let service: SupabaseClient;

const ids = {
  tenantId: "",
  practiceLineId: "",
  otherPracticeLineId: "",
  stageId: "",
  accountId: "",
  dealId: "",
  teamLeadAuthId: "",
  directorAuthId: "",
  bde1AuthId: "",
  bde2AuthId: "",
  otherPracticeBdeAuthId: "",
};

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

async function makeTaskAs(email: string, title: string, assigneeId: string, dueDate: string): Promise<string> {
  const client = await signIn(email);
  const session = await getSessionActor(client);
  if (session.status !== "active") throw new Error("expected an active session");
  const result = await createTask(client, session.actor, {
    dealId: ids.dealId,
    originActivityId: null,
    title,
    description: null,
    assigneeId,
    dueDate,
    priority: "normal",
  });
  if (!result.ok) throw new Error(`fixture createTask failed: ${result.code}`);
  return result.task.id;
}

beforeAll(async () => {
  service = createServiceClient();

  ids.tenantId = await findOrCreateTenant(service, "m4-6-integration-test", "M4.6 Integration Test Tenant");

  ids.practiceLineId = await findOrCreateByUniqueMatch(
    service,
    "practice_lines",
    { tenant_id: ids.tenantId, code: "ADV" },
    { tenant_id: ids.tenantId, name: "Advisory", code: "ADV" },
  );
  ids.otherPracticeLineId = await findOrCreateByUniqueMatch(
    service,
    "practice_lines",
    { tenant_id: ids.tenantId, code: "ES" },
    { tenant_id: ids.tenantId, name: "Executive Search", code: "ES" },
  );

  ids.stageId = await findOrCreateByUniqueMatch(
    service,
    "pipeline_stages",
    { tenant_id: ids.tenantId, code: "DISCOVERY" },
    { tenant_id: ids.tenantId, name: "Discovery", code: "DISCOVERY", sort_order: 1, probability_threshold: 20, stage_type: "open" },
  );

  ids.accountId = await findOrCreateByUniqueMatch(
    service,
    "accounts",
    { tenant_id: ids.tenantId, name: "M4.6 Test Client" },
    { tenant_id: ids.tenantId, name: "M4.6 Test Client" },
  );

  ids.teamLeadAuthId = await findOrCreateUser(service, ids.tenantId, "m4-6-teamlead@example.com", "M4.6 Team Lead", PASSWORD);
  ids.directorAuthId = await findOrCreateUser(service, ids.tenantId, "m4-6-director@example.com", "M4.6 Director", PASSWORD);
  ids.bde1AuthId = await findOrCreateUser(service, ids.tenantId, "m4-6-bde1@example.com", "M4.6 Bde One", PASSWORD);
  ids.bde2AuthId = await findOrCreateUser(service, ids.tenantId, "m4-6-bde2@example.com", "M4.6 Bde Two", PASSWORD);
  ids.otherPracticeBdeAuthId = await findOrCreateUser(service, ids.tenantId, "m4-6-bde-other-practice@example.com", "M4.6 Bde Other Practice", PASSWORD);

  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  await service.from("user_roles").insert([
    { tenant_id: ids.tenantId, user_id: ids.teamLeadAuthId, role: "team_lead", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.directorAuthId, role: "director", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.bde1AuthId, role: "bde", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.bde2AuthId, role: "bde", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.otherPracticeBdeAuthId, role: "bde", practice_line_id: ids.otherPracticeLineId },
  ]);

  await service.from("account_practice_owners").delete().eq("account_id", ids.accountId);
  await service
    .from("account_practice_owners")
    .insert({ account_id: ids.accountId, practice_line_id: ids.practiceLineId, owner_id: ids.teamLeadAuthId });

  ids.dealId = await findOrCreateByUniqueMatch(
    service,
    "deals",
    { tenant_id: ids.tenantId, reference: "D-TEAM-1" },
    {
      tenant_id: ids.tenantId,
      reference: "D-TEAM-1",
      name: "Team Integration Test Deal",
      account_id: ids.accountId,
      practice_line_id: ids.practiceLineId,
      stage_id: ids.stageId,
      client_type: "new",
      owner_id: ids.teamLeadAuthId,
      author_id: ids.teamLeadAuthId,
      status: "active",
      expected_close_date: "2027-06-01",
    },
  );

  // Fresh, deterministic task state per fixture run: soft-delete every existing task on this deal
  // (tasks_select/getTeamTaskCounts both already filter deleted_at is null) rather than trying to
  // reason about whatever a prior run left behind - tasks are permanently un-deletable once
  // referenced by task_assignments, so "start clean" here means "start invisible", not "start
  // empty".
  await service.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("deal_id", ids.dealId).is("deleted_at", null);

  const overdueTaskId = await makeTaskAs("m4-6-teamlead@example.com", "Bde1 overdue task", ids.bde1AuthId, "2026-01-01");
  await makeTaskAs("m4-6-teamlead@example.com", "Bde1 open future task", ids.bde1AuthId, "2027-01-01");
  const toCompleteId = await makeTaskAs("m4-6-teamlead@example.com", "Bde1 task to complete", ids.bde1AuthId, "2027-01-02");
  await makeTaskAs("m4-6-teamlead@example.com", "Bde2 open task", ids.bde2AuthId, "2027-01-03");

  const bde1Client = await signIn("m4-6-bde1@example.com");
  const bde1Session = await getSessionActor(bde1Client);
  if (bde1Session.status !== "active") throw new Error("expected an active session");
  await completeTask(bde1Client, bde1Session.actor, toCompleteId);

  // Keep the overdue task's own id referenced so a future maintainer editing this fixture doesn't
  // accidentally think it's unused - it exists purely via its due date already being in the past.
  void overdueTaskId;
});

afterAll(async () => {
  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
});

describe("getTeamOverview, end to end against a real signed-in session", () => {
  it("a team_lead sees per-person open/overdue/completed counts for their own practice, excluding the other practice's bde", async () => {
    const client = await signIn("m4-6-teamlead@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await getTeamOverview(client, session.actor, "Africa/Lagos");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const memberIds = result.members.map((m) => m.id);
    expect(memberIds).toEqual(expect.arrayContaining([ids.teamLeadAuthId, ids.directorAuthId, ids.bde1AuthId, ids.bde2AuthId]));
    expect(memberIds).not.toContain(ids.otherPracticeBdeAuthId);

    const bde1 = result.members.find((m) => m.id === ids.bde1AuthId);
    expect(bde1).toMatchObject({ fullName: "M4.6 Bde One", role: "bde", open: 2, overdue: 1, completedRecently: 1 });

    const bde2 = result.members.find((m) => m.id === ids.bde2AuthId);
    expect(bde2).toMatchObject({ fullName: "M4.6 Bde Two", role: "bde", open: 1, overdue: 0, completedRecently: 0 });
  });

  it("a director in the same practice sees the identical roster and counts", async () => {
    const client = await signIn("m4-6-director@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await getTeamOverview(client, session.actor, "Africa/Lagos");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const bde1 = result.members.find((m) => m.id === ids.bde1AuthId);
    expect(bde1).toMatchObject({ open: 2, overdue: 1, completedRecently: 1 });
  });

  it("a plain bde (no team_lead/director grant) is denied", async () => {
    const client = await signIn("m4-6-bde1@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await getTeamOverview(client, session.actor, "Africa/Lagos");
    expect(result).toEqual({ ok: false, code: "denied" });
  });
});
