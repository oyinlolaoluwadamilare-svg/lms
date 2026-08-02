import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSessionActor } from "@/services/actor";
import { completeTask, createTask, getReassignContext, listMyWork, snoozeTask } from "@/services/tasks";
import { findOrCreateByUniqueMatch, findOrCreateTenant, findOrCreateUser, signIn as signInAs } from "./support/permanentFixture";

// M4.5 exit criteria (docs/07-build-backlog.md): "My Work screen: grouped queue, inline complete,
// snooze with reason after two snoozes, reassign, plus the 'Assigned by me' tab." Exercises
// completeTask/snoozeTask/listMyWork/getReassignContext end to end against the real hosted project.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M4-5-Integration-Test-Pw1!";

let service: SupabaseClient;

const ids = {
  tenantId: "",
  practiceLineId: "",
  otherPracticeLineId: "",
  stageId: "",
  accountId: "",
  dealId: "",
  bdeAuthId: "",
  practicePeerAuthId: "",
  thirdBdeAuthId: "",
  otherPracticeBdeAuthId: "",
};

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

async function makeTask(title: string, assigneeId: string, dueDate: string): Promise<string> {
  const client = await signIn("m4-5-bde@example.com");
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

  ids.tenantId = await findOrCreateTenant(service, "m4-5-integration-test", "M4.5 Integration Test Tenant");

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
    { tenant_id: ids.tenantId, name: "M4.5 Test Client" },
    { tenant_id: ids.tenantId, name: "M4.5 Test Client" },
  );

  ids.bdeAuthId = await findOrCreateUser(service, ids.tenantId, "m4-5-bde@example.com", "M4.5 Bde", PASSWORD);
  ids.practicePeerAuthId = await findOrCreateUser(service, ids.tenantId, "m4-5-bde-peer@example.com", "M4.5 Bde Peer", PASSWORD);
  ids.thirdBdeAuthId = await findOrCreateUser(service, ids.tenantId, "m4-5-bde-third@example.com", "M4.5 Bde Third", PASSWORD);
  ids.otherPracticeBdeAuthId = await findOrCreateUser(service, ids.tenantId, "m4-5-bde-other-practice@example.com", "M4.5 Bde Other Practice", PASSWORD);

  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  await service.from("user_roles").insert([
    { tenant_id: ids.tenantId, user_id: ids.bdeAuthId, role: "bde", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.practicePeerAuthId, role: "bde", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.thirdBdeAuthId, role: "bde", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.otherPracticeBdeAuthId, role: "bde", practice_line_id: ids.otherPracticeLineId },
  ]);

  await service.from("account_practice_owners").delete().eq("account_id", ids.accountId);
  await service
    .from("account_practice_owners")
    .insert({ account_id: ids.accountId, practice_line_id: ids.practiceLineId, owner_id: ids.bdeAuthId });

  ids.dealId = await findOrCreateByUniqueMatch(
    service,
    "deals",
    { tenant_id: ids.tenantId, reference: "D-MYWORK-1" },
    {
      tenant_id: ids.tenantId,
      reference: "D-MYWORK-1",
      name: "My Work Integration Test Deal",
      account_id: ids.accountId,
      practice_line_id: ids.practiceLineId,
      stage_id: ids.stageId,
      client_type: "new",
      owner_id: ids.bdeAuthId,
      author_id: ids.bdeAuthId,
      status: "active",
      expected_close_date: "2027-06-01",
    },
  );
});

afterAll(async () => {
  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
});

describe("completeTask, end to end against a real signed-in session", () => {
  it("the assignee completes their own task: status/completed_at/completed_by are set and one audit row is written", async () => {
    const taskId = await makeTask("Task to complete", ids.bdeAuthId, "2027-04-01");

    const client = await signIn("m4-5-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const { count: auditBefore } = await service
      .from("audit_entries")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "task")
      .eq("action", "task.complete");

    const result = await completeTask(client, session.actor, taskId);
    expect(result).toEqual({ ok: true });

    const { data: row } = await service.from("tasks").select("status, completed_at, completed_by").eq("id", taskId).single();
    expect(row?.status).toBe("done");
    expect(row?.completed_at).not.toBeNull();
    expect(row?.completed_by).toBe(ids.bdeAuthId);

    const { count: auditAfter } = await service
      .from("audit_entries")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "task")
      .eq("action", "task.complete");
    expect(auditAfter).toBe((auditBefore ?? 0) + 1);
  });

  it("completing an already-done task is rejected - already_done", async () => {
    const taskId = await makeTask("Already done task", ids.bdeAuthId, "2027-04-02");
    await service.from("tasks").update({ status: "done", completed_at: new Date().toISOString(), completed_by: ids.bdeAuthId }).eq("id", taskId);

    const client = await signIn("m4-5-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await completeTask(client, session.actor, taskId);
    expect(result).toEqual({ ok: false, code: "already_done" });
  });

  it("a practice peer who is neither the assignee nor the assigner is denied completing it", async () => {
    const taskId = await makeTask("Not the third bde's task", ids.bdeAuthId, "2027-04-03");

    const client = await signIn("m4-5-bde-third@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await completeTask(client, session.actor, taskId);
    expect(result).toEqual({ ok: false, code: "denied" });
  });
});

describe("snoozeTask, end to end against a real signed-in session", () => {
  it("the first two snoozes need no reason; the third requires one", async () => {
    const taskId = await makeTask("Task to snooze repeatedly", ids.bdeAuthId, "2027-05-01");

    const client = await signIn("m4-5-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const first = await snoozeTask(client, session.actor, taskId, "2027-05-02", null);
    expect(first).toEqual({ ok: true });

    const second = await snoozeTask(client, session.actor, taskId, "2027-05-03", null);
    expect(second).toEqual({ ok: true });

    const thirdNoReason = await snoozeTask(client, session.actor, taskId, "2027-05-04", null);
    expect(thirdNoReason).toEqual({ ok: false, code: "reason_required" });

    const thirdWithReason = await snoozeTask(client, session.actor, taskId, "2027-05-04", "Client asked to push");
    expect(thirdWithReason).toEqual({ ok: true });

    const { data: row } = await service.from("tasks").select("due_date, snooze_count").eq("id", taskId).single();
    expect(row).toMatchObject({ due_date: "2027-05-04", snooze_count: 3 });

    const { data: auditRows } = await service
      .from("audit_entries")
      .select("after")
      .eq("entity_type", "task")
      .eq("action", "task.snooze")
      .eq("entity_id", taskId)
      .order("occurred_at", { ascending: false })
      .limit(1);
    expect(auditRows?.[0]?.after).toMatchObject({ reason: "Client asked to push" });
  });

  it("snoozing to an earlier or equal date is rejected - must_be_later", async () => {
    const taskId = await makeTask("Task with a due date", ids.bdeAuthId, "2027-05-10");

    const client = await signIn("m4-5-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const same = await snoozeTask(client, session.actor, taskId, "2027-05-10", null);
    expect(same).toEqual({ ok: false, code: "must_be_later" });

    const earlier = await snoozeTask(client, session.actor, taskId, "2027-05-01", null);
    expect(earlier).toEqual({ ok: false, code: "must_be_later" });
  });

  it("a cancelled task cannot be snoozed", async () => {
    const taskId = await makeTask("Cancelled task", ids.bdeAuthId, "2027-05-15");
    await service.from("tasks").update({ status: "cancelled" }).eq("id", taskId);

    const client = await signIn("m4-5-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await snoozeTask(client, session.actor, taskId, "2027-05-20", null);
    expect(result).toEqual({ ok: false, code: "cancelled" });
  });
});

describe("listMyWork, end to end against a real signed-in session", () => {
  it("'assigned to me' returns tasks assigned to the viewer; 'assigned by me' returns tasks the viewer assigned to someone else", async () => {
    const client = await signIn("m4-5-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const selfTaskId = await makeTask("Self-assigned for listMyWork", ids.bdeAuthId, "2027-06-01");
    const delegatedTaskId = await makeTask("Delegated for listMyWork", ids.practicePeerAuthId, "2027-06-02");

    const assignedToMe = await listMyWork(client, session.actor, "assigned_to_me");
    expect(assignedToMe.map((t) => t.id)).toContain(selfTaskId);
    expect(assignedToMe.map((t) => t.id)).not.toContain(delegatedTaskId);

    const assignedByMe = await listMyWork(client, session.actor, "assigned_by_me");
    expect(assignedByMe.map((t) => t.id)).toContain(selfTaskId);
    expect(assignedByMe.map((t) => t.id)).toContain(delegatedTaskId);
    const delegated = assignedByMe.find((t) => t.id === delegatedTaskId);
    expect(delegated).toMatchObject({ assigneeId: ids.practicePeerAuthId, assigneeName: "M4.5 Bde Peer", dealId: ids.dealId });
  });
});

describe("getReassignContext, end to end against a real signed-in session", () => {
  it("the current assignee gets a practice-scoped picker", async () => {
    const taskId = await makeTask("Task for reassign context", ids.bdeAuthId, "2027-07-01");

    const client = await signIn("m4-5-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const context = await getReassignContext(client, session.actor, taskId);
    expect(context.canReassign).toBe(true);
    const offeredIds = context.assignableUsers.map((u) => u.id);
    expect(offeredIds).toEqual(expect.arrayContaining([ids.bdeAuthId, ids.practicePeerAuthId]));
    expect(offeredIds).not.toContain(ids.otherPracticeBdeAuthId);
  });

  it("a practice peer who is neither assignee nor assigner is denied - empty picker", async () => {
    const taskId = await makeTask("Not the third bde's to reassign", ids.bdeAuthId, "2027-07-02");

    const client = await signIn("m4-5-bde-third@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const context = await getReassignContext(client, session.actor, taskId);
    expect(context).toEqual({ canReassign: false, assignableUsers: [] });
  });

  it("a deal-less task falls back to a tenant-wide picker", async () => {
    const client = await signIn("m4-5-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const created = await createTask(client, session.actor, {
      dealId: null,
      originActivityId: null,
      title: "Deal-less task for reassign context",
      description: null,
      assigneeId: ids.bdeAuthId,
      dueDate: "2027-07-03",
      priority: "normal",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const context = await getReassignContext(client, session.actor, created.task.id);
    expect(context.canReassign).toBe(true);
    // Tenant-wide, not practice-filtered - includes a bde from the OTHER practice line too.
    expect(context.assignableUsers.map((u) => u.id)).toContain(ids.otherPracticeBdeAuthId);
  });
});
