import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSessionActor } from "@/services/actor";
import { createTask, getAddTaskContext } from "@/services/tasks";
import { findOrCreateByUniqueMatch, findOrCreateTenant, findOrCreateUser, signIn as signInAs } from "./support/permanentFixture";

// M4.3 exit criteria (docs/07-build-backlog.md): "Add Task modal with the scope-filtered assignee
// picker; 'Save and add task' continuation from the activity modal." This exercises createTask (the
// service layer behind both the standalone Add Task modal and LogActivityModal's "Save and add
// task") end to end against the real hosted project: real signed-in sessions, the real can()
// task.create/task.assign_to_self/task.assign_to_other checks, the real tasks_insert RLS policy,
// and the real service-role writes for the first task_assignments ledger row and the task_assigned
// notification. Also covers getAddTaskContext, the query behind the picker itself.
//
// tasks has a real FK to deals (no cascade), and task_assignments is an immutable ledger - once a
// creation writes a ledger row referencing this fixture's users/deal, none of them can ever be
// deleted again. Find-or-create for everything, never delete-and-recreate.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M4-3-Integration-Test-Pw1!";

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
  otherPracticeBdeAuthId: "",
  otherPracticeDirectorAuthId: "",
  executiveAuthId: "",
};

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

beforeAll(async () => {
  service = createServiceClient();

  ids.tenantId = await findOrCreateTenant(service, "m4-3-integration-test", "M4.3 Integration Test Tenant");

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
    { tenant_id: ids.tenantId, name: "M4.3 Test Client" },
    { tenant_id: ids.tenantId, name: "M4.3 Test Client" },
  );

  ids.bdeAuthId = await findOrCreateUser(service, ids.tenantId, "m4-3-bde@example.com", "M4.3 Bde", PASSWORD);
  ids.practicePeerAuthId = await findOrCreateUser(service, ids.tenantId, "m4-3-bde-peer@example.com", "M4.3 Bde Peer", PASSWORD);
  ids.otherPracticeBdeAuthId = await findOrCreateUser(service, ids.tenantId, "m4-3-bde-other-practice@example.com", "M4.3 Bde Other Practice", PASSWORD);
  ids.otherPracticeDirectorAuthId = await findOrCreateUser(
    service,
    ids.tenantId,
    "m4-3-director-other-practice@example.com",
    "M4.3 Director Other Practice",
    PASSWORD,
  );
  ids.executiveAuthId = await findOrCreateUser(service, ids.tenantId, "m4-3-executive@example.com", "M4.3 Executive", PASSWORD);

  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  await service.from("user_roles").insert([
    { tenant_id: ids.tenantId, user_id: ids.bdeAuthId, role: "bde", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.practicePeerAuthId, role: "bde", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.otherPracticeBdeAuthId, role: "bde", practice_line_id: ids.otherPracticeLineId },
    { tenant_id: ids.tenantId, user_id: ids.otherPracticeDirectorAuthId, role: "director", practice_line_id: ids.otherPracticeLineId },
    { tenant_id: ids.tenantId, user_id: ids.executiveAuthId, role: "executive", practice_line_id: null },
  ]);

  // D-03: accounts_select needs an account_practice_owners row (migration 0005).
  await service.from("account_practice_owners").delete().eq("account_id", ids.accountId);
  await service
    .from("account_practice_owners")
    .insert({ account_id: ids.accountId, practice_line_id: ids.practiceLineId, owner_id: ids.bdeAuthId });

  ids.dealId = await findOrCreateByUniqueMatch(
    service,
    "deals",
    { tenant_id: ids.tenantId, reference: "D-CREATETASK-1" },
    {
      tenant_id: ids.tenantId,
      reference: "D-CREATETASK-1",
      name: "Create Task Integration Test Deal",
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
  // these fixture rows.
});

describe("createTask, end to end against a real signed-in session", () => {
  it("a bde self-assigns a task on their own deal: task row, first-assignment ledger row and audit row are written, and no notification is sent", async () => {
    const client = await signIn("m4-3-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const { count: auditBefore } = await service
      .from("audit_entries")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "task")
      .eq("action", "task.create");

    const result = await createTask(client, session.actor, {
      dealId: ids.dealId,
      originActivityId: null,
      title: "Self-assigned follow-up call",
      description: null,
      assigneeId: ids.bdeAuthId,
      dueDate: "2027-01-01",
      priority: "normal",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { data: taskRow } = await service
      .from("tasks")
      .select("title, deal_id, assignee_id, assigned_by, due_date, priority, status")
      .eq("id", result.task.id)
      .single();
    expect(taskRow).toMatchObject({
      title: "Self-assigned follow-up call",
      deal_id: ids.dealId,
      assignee_id: ids.bdeAuthId,
      assigned_by: ids.bdeAuthId,
      due_date: "2027-01-01",
      priority: "normal",
      status: "open",
    });

    const { data: ledgerRow } = await service
      .from("task_assignments")
      .select("from_user_id, to_user_id, assigned_by")
      .eq("task_id", result.task.id)
      .maybeSingle();
    expect(ledgerRow).toMatchObject({ from_user_id: null, to_user_id: ids.bdeAuthId, assigned_by: ids.bdeAuthId });

    const { data: notification } = await service.from("notifications").select("id").eq("entity_id", result.task.id).eq("event_type", "task_assigned").maybeSingle();
    expect(notification).toBeNull();

    const { count: auditAfter } = await service
      .from("audit_entries")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "task")
      .eq("action", "task.create");
    expect(auditAfter).toBe((auditBefore ?? 0) + 1);
  });

  it("a bde assigns a new task to a practice peer: 'they will be notified' becomes a real task_assigned notification", async () => {
    const client = await signIn("m4-3-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await createTask(client, session.actor, {
      dealId: ids.dealId,
      originActivityId: null,
      title: "Delegated to a practice peer",
      description: "Please follow up",
      assigneeId: ids.practicePeerAuthId,
      dueDate: "2027-01-02",
      priority: "high",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { data: notification } = await service
      .from("notifications")
      .select("recipient_id, actor_id, event_type, entity_type, entity_id")
      .eq("entity_id", result.task.id)
      .eq("event_type", "task_assigned")
      .maybeSingle();
    expect(notification).toMatchObject({
      recipient_id: ids.practicePeerAuthId,
      actor_id: ids.bdeAuthId,
      event_type: "task_assigned",
      entity_type: "task",
    });
  });

  it("a bde cannot assign a new task to someone outside their practice line - denied, footnote 3's set is exactly practice membership", async () => {
    const client = await signIn("m4-3-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await createTask(client, session.actor, {
      dealId: ids.dealId,
      originActivityId: null,
      title: "Should never be created",
      description: null,
      assigneeId: ids.otherPracticeBdeAuthId,
      dueDate: "2027-01-03",
      priority: "normal",
    });
    expect(result).toEqual({ ok: false, code: "denied" });
  });

  it("an executive cannot create a task at all - denied, even though they can see the deal", async () => {
    const client = await signIn("m4-3-executive@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await createTask(client, session.actor, {
      dealId: ids.dealId,
      originActivityId: null,
      title: "Should never be created",
      description: null,
      assigneeId: ids.executiveAuthId,
      dueDate: "2027-01-04",
      priority: "normal",
    });
    expect(result).toEqual({ ok: false, code: "denied" });
  });

  it("a director outside the deal's practice line can't even see the deal - not_found", async () => {
    const client = await signIn("m4-3-director-other-practice@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await createTask(client, session.actor, {
      dealId: ids.dealId,
      originActivityId: null,
      title: "Should never be created",
      description: null,
      assigneeId: ids.otherPracticeDirectorAuthId,
      dueDate: "2027-01-05",
      priority: "normal",
    });
    expect(result).toEqual({ ok: false, code: "not_found" });
  });

  it("assigning to a non-existent user id is rejected - invalid_assignee, not a thrown FK error", async () => {
    const client = await signIn("m4-3-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await createTask(client, session.actor, {
      dealId: ids.dealId,
      originActivityId: null,
      title: "Should never be created",
      description: null,
      assigneeId: "11111111-1111-1111-1111-111111111111",
      dueDate: "2027-01-06",
      priority: "normal",
    });
    expect(result).toEqual({ ok: false, code: "invalid_assignee" });
  });

  it("a deal-less personal task can be self-assigned by any practice-scoped writer - the relaxed scope migration 0011's tasks_insert policy documents", async () => {
    const client = await signIn("m4-3-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await createTask(client, session.actor, {
      dealId: null,
      originActivityId: null,
      title: "Personal task, no deal",
      description: null,
      assigneeId: ids.bdeAuthId,
      dueDate: "2027-01-07",
      priority: "low",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { data: taskRow } = await service.from("tasks").select("deal_id, assignee_id").eq("id", result.task.id).single();
    expect(taskRow).toMatchObject({ deal_id: null, assignee_id: ids.bdeAuthId });
  });

  it("carries origin_activity_id forward - the 'Save and add task' continuation's own field", async () => {
    const client = await signIn("m4-3-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const { data: activity, error: activityError } = await service
      .from("activities")
      .insert({
        tenant_id: ids.tenantId,
        deal_id: ids.dealId,
        type: "call",
        activity_date: "2026-01-01",
        summary: "Origin activity for save-and-add-task",
        author_id: ids.bdeAuthId,
      })
      .select("id")
      .single();
    if (activityError) throw new Error(`fixture activity insert failed: ${activityError.message}`);

    const result = await createTask(client, session.actor, {
      dealId: ids.dealId,
      originActivityId: activity!.id,
      title: "Follow-up task from an activity",
      description: null,
      assigneeId: ids.bdeAuthId,
      dueDate: "2027-01-08",
      priority: "normal",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { data: taskRow } = await service.from("tasks").select("origin_activity_id").eq("id", result.task.id).single();
    expect(taskRow?.origin_activity_id).toBe(activity!.id);
  });
});

describe("getAddTaskContext, end to end against a real signed-in session", () => {
  it("a practice-entitled bde can add a task, and the picker offers only their own practice's working roles plus tenant-wide roles", async () => {
    const client = await signIn("m4-3-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const context = await getAddTaskContext(client, session.actor, ids.dealId);
    expect(context.canAddTask).toBe(true);

    const offeredIds = context.assignableUsers.map((u) => u.id);
    expect(offeredIds).toEqual(expect.arrayContaining([ids.bdeAuthId, ids.practicePeerAuthId]));
    expect(offeredIds).not.toContain(ids.otherPracticeBdeAuthId);
    expect(offeredIds).not.toContain(ids.otherPracticeDirectorAuthId);
    expect(offeredIds).not.toContain(ids.executiveAuthId);
  });

  it("an executive gets canAddTask: false and an empty picker, even though they can see the deal", async () => {
    const client = await signIn("m4-3-executive@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const context = await getAddTaskContext(client, session.actor, ids.dealId);
    expect(context).toEqual({ canAddTask: false, assignableUsers: [] });
  });

  it("a director outside the deal's practice line can't even see the deal - canAddTask: false", async () => {
    const client = await signIn("m4-3-director-other-practice@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const context = await getAddTaskContext(client, session.actor, ids.dealId);
    expect(context).toEqual({ canAddTask: false, assignableUsers: [] });
  });
});
