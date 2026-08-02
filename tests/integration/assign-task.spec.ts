import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSessionActor } from "@/services/actor";
import { assignTask } from "@/services/tasks";
import { findOrCreateByUniqueMatch, findOrCreateTenant, findOrCreateUser, signIn as signInAs } from "./support/permanentFixture";

// M4.2 exit criteria (docs/07-build-backlog.md): "`assignTask` as the single assignment path,
// writing the ledger entry and notification." Exercises the real chain against the real hosted
// project: real signed-in sessions, the real can() "task.reassign" check, the real tasks_update RLS
// policy for the reassignment write itself, and the real service-role writes for the task_assignments
// ledger row and the notifications row.
//
// No createTask service exists yet (M4.2 operates on an EXISTING task only - see
// src/services/tasks.ts's own header comment), so this fixture seeds tasks directly via the
// service-role client, the same "insert the row a real service would produce" shape
// edit-retract-activity.spec.ts's own `edit_locked_at` fixture case already established.
//
// tasks has real FKs (assignee_id/assigned_by/deal_id -> users/deals), and task_assignments is an
// immutable ledger (forbid_mutation) - once a reassignment writes a ledger row referencing this
// fixture's users/deal, none of them can ever be deleted again. Find-or-create for everything, never
// delete-and-recreate, the same convention every M3 integration fixture already established.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M4-2-Integration-Test-Pw1!";

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
  directorAuthId: "",
  otherPracticeDirectorAuthId: "",
};

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

async function createTestTask(overrides: Partial<{ dealId: string | null; assigneeId: string; assignedById: string; title: string }> = {}): Promise<string> {
  const { data, error } = await service
    .from("tasks")
    .insert({
      tenant_id: ids.tenantId,
      deal_id: overrides.dealId === undefined ? ids.dealId : overrides.dealId,
      title: overrides.title ?? "M4.2 assignTask test task",
      assignee_id: overrides.assigneeId ?? ids.bdeAuthId,
      assigned_by: overrides.assignedById ?? ids.bdeAuthId,
      due_date: "2027-01-01",
    })
    .select("id")
    .single();

  if (error) throw new Error(`fixture createTestTask failed: ${error.message}`);
  return data.id;
}

beforeAll(async () => {
  service = createServiceClient();

  ids.tenantId = await findOrCreateTenant(service, "m4-2-integration-test", "M4.2 Integration Test Tenant");

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
    { tenant_id: ids.tenantId, name: "M4.2 Test Client" },
    { tenant_id: ids.tenantId, name: "M4.2 Test Client" },
  );

  ids.bdeAuthId = await findOrCreateUser(service, ids.tenantId, "m4-2-bde@example.com", "M4.2 Bde", PASSWORD);
  ids.practicePeerAuthId = await findOrCreateUser(service, ids.tenantId, "m4-2-bde-peer@example.com", "M4.2 Bde Peer", PASSWORD);
  ids.thirdBdeAuthId = await findOrCreateUser(service, ids.tenantId, "m4-2-bde-third@example.com", "M4.2 Bde Third", PASSWORD);
  ids.directorAuthId = await findOrCreateUser(service, ids.tenantId, "m4-2-director@example.com", "M4.2 Director", PASSWORD);
  ids.otherPracticeDirectorAuthId = await findOrCreateUser(
    service,
    ids.tenantId,
    "m4-2-director-other-practice@example.com",
    "M4.2 Director Other Practice",
    PASSWORD,
  );

  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  await service.from("user_roles").insert([
    { tenant_id: ids.tenantId, user_id: ids.bdeAuthId, role: "bde", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.practicePeerAuthId, role: "bde", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.thirdBdeAuthId, role: "bde", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.directorAuthId, role: "director", practice_line_id: ids.practiceLineId },
    {
      tenant_id: ids.tenantId,
      user_id: ids.otherPracticeDirectorAuthId,
      role: "director",
      practice_line_id: ids.otherPracticeLineId,
    },
  ]);

  // D-03: accounts_select needs an account_practice_owners row (migration 0005).
  await service.from("account_practice_owners").delete().eq("account_id", ids.accountId);
  await service
    .from("account_practice_owners")
    .insert({ account_id: ids.accountId, practice_line_id: ids.practiceLineId, owner_id: ids.bdeAuthId });

  ids.dealId = await findOrCreateByUniqueMatch(
    service,
    "deals",
    { tenant_id: ids.tenantId, reference: "D-ASSIGNTASK-1" },
    {
      tenant_id: ids.tenantId,
      reference: "D-ASSIGNTASK-1",
      name: "Assign Task Integration Test Deal",
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
  // Deliberately not deleting tasks/task_assignments/notifications/the deal/account/stage/practice
  // lines/users/tenant - see this file's header comment. beforeAll is find-or-create for all of
  // these fixture rows; tasks created per-test are left in place (task_assignments' forbid_mutation
  // trigger and its FK to tasks would make deleting them impossible after the first reassignment
  // anyway).
});

describe("assignTask, end to end against a real signed-in session", () => {
  it("the current assignee reassigns to a practice peer: ledger row, notification, and audit row are all written, and assigned_by moves to the actor", async () => {
    const taskId = await createTestTask({ assigneeId: ids.bdeAuthId, assignedById: ids.bdeAuthId });

    const client = await signIn("m4-2-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const { count: assignmentsBefore } = await service
      .from("task_assignments")
      .select("id", { count: "exact", head: true })
      .eq("task_id", taskId);
    const { count: auditBefore } = await service
      .from("audit_entries")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "task")
      .eq("action", "task.reassign");

    const result = await assignTask(client, session.actor, taskId, ids.practicePeerAuthId);
    expect(result).toEqual({ ok: true });

    const { data: taskRow } = await service.from("tasks").select("assignee_id, assigned_by").eq("id", taskId).single();
    expect(taskRow?.assignee_id).toBe(ids.practicePeerAuthId);
    expect(taskRow?.assigned_by).toBe(ids.bdeAuthId);

    const { data: assignments, count: assignmentsAfter } = await service
      .from("task_assignments")
      .select("from_user_id, to_user_id, assigned_by", { count: "exact" })
      .eq("task_id", taskId);
    expect(assignmentsAfter).toBe((assignmentsBefore ?? 0) + 1);
    const newest = assignments?.find((row) => row.to_user_id === ids.practicePeerAuthId);
    expect(newest).toMatchObject({ from_user_id: ids.bdeAuthId, to_user_id: ids.practicePeerAuthId, assigned_by: ids.bdeAuthId });

    const { data: notification } = await service
      .from("notifications")
      .select("recipient_id, actor_id, event_type, entity_type, entity_id, title")
      .eq("entity_id", taskId)
      .eq("event_type", "task_reassigned")
      .maybeSingle();
    expect(notification).toMatchObject({
      recipient_id: ids.practicePeerAuthId,
      actor_id: ids.bdeAuthId,
      event_type: "task_reassigned",
      entity_type: "task",
      entity_id: taskId,
    });

    const { count: auditAfter } = await service
      .from("audit_entries")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "task")
      .eq("action", "task.reassign");
    expect(auditAfter).toBe((auditBefore ?? 0) + 1);
  });

  it("reassigning to the current assignee is rejected - same_assignee, no writes", async () => {
    const taskId = await createTestTask({ assigneeId: ids.bdeAuthId, assignedById: ids.bdeAuthId });

    const client = await signIn("m4-2-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await assignTask(client, session.actor, taskId, ids.bdeAuthId);
    expect(result).toEqual({ ok: false, code: "same_assignee" });

    const { count } = await service.from("task_assignments").select("id", { count: "exact", head: true }).eq("task_id", taskId);
    expect(count ?? 0).toBe(0);
  });

  it("a practice peer who is neither the assignee nor the assigner can see the task but cannot reassign it - denied, not not_found", async () => {
    const taskId = await createTestTask({ assigneeId: ids.bdeAuthId, assignedById: ids.bdeAuthId });

    const client = await signIn("m4-2-bde-third@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await assignTask(client, session.actor, taskId, ids.practicePeerAuthId);
    expect(result).toEqual({ ok: false, code: "denied" });
  });

  it("a practice director can reassign a task they neither own nor were assigned, via the practice-wide scope", async () => {
    const taskId = await createTestTask({ assigneeId: ids.bdeAuthId, assignedById: ids.bdeAuthId });

    const client = await signIn("m4-2-director@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await assignTask(client, session.actor, taskId, ids.practicePeerAuthId);
    expect(result).toEqual({ ok: true });

    const { data: taskRow } = await service.from("tasks").select("assignee_id, assigned_by").eq("id", taskId).single();
    expect(taskRow?.assignee_id).toBe(ids.practicePeerAuthId);
    expect(taskRow?.assigned_by).toBe(ids.directorAuthId);
  });

  it("a director in a different practice line can't even see the task - not_found, same convention every other cross-practice case uses", async () => {
    const taskId = await createTestTask({ assigneeId: ids.bdeAuthId, assignedById: ids.bdeAuthId });

    const client = await signIn("m4-2-director-other-practice@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await assignTask(client, session.actor, taskId, ids.practicePeerAuthId);
    expect(result).toEqual({ ok: false, code: "not_found" });
  });

  it("a non-existent task id resolves to not_found", async () => {
    const client = await signIn("m4-2-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await assignTask(client, session.actor, "00000000-0000-0000-0000-000000000000", ids.practicePeerAuthId);
    expect(result).toEqual({ ok: false, code: "not_found" });
  });

  it("reassigning to a non-existent user id is rejected - invalid_assignee, not a thrown FK error", async () => {
    const taskId = await createTestTask({ assigneeId: ids.bdeAuthId, assignedById: ids.bdeAuthId });

    const client = await signIn("m4-2-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await assignTask(client, session.actor, taskId, "11111111-1111-1111-1111-111111111111");
    expect(result).toEqual({ ok: false, code: "invalid_assignee" });

    const { data: taskRow } = await service.from("tasks").select("assignee_id").eq("id", taskId).single();
    expect(taskRow?.assignee_id).toBe(ids.bdeAuthId);
  });

  it("a deal-less personal task can still be reassigned by its own assignee", async () => {
    const taskId = await createTestTask({ dealId: null, assigneeId: ids.bdeAuthId, assignedById: ids.bdeAuthId, title: "Personal task, no deal" });

    const client = await signIn("m4-2-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await assignTask(client, session.actor, taskId, ids.practicePeerAuthId);
    expect(result).toEqual({ ok: true });

    const { data: taskRow } = await service.from("tasks").select("assignee_id").eq("id", taskId).single();
    expect(taskRow?.assignee_id).toBe(ids.practicePeerAuthId);
  });
});
