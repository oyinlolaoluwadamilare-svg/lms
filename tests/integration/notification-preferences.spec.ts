import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSessionActor } from "@/services/actor";
import { assignTask, createTask } from "@/services/tasks";
import { getNotificationPreferences, setNotificationPreference } from "@/services/notifications";
import { findOrCreateByUniqueMatch, findOrCreateTenant, findOrCreateUser, signIn as signInAs } from "./support/permanentFixture";

// M4.8 exit criteria (docs/07-build-backlog.md): "Notification events for assigned, reassigned,
// overdue and mentioned, with per-type user preferences replacing coarse toggles." Proves, against
// the real hosted project:
// - the preference gate (src/services/notifications.ts's sendNotification) actually suppresses a
//   notification once the recipient opts out, and resumes once they opt back in - createTask's own
//   existing "task_assigned" notification (tests/integration/create-task.spec.ts) and assignTask's
//   own existing "task_reassigned" notification (tests/integration/assign-task.spec.ts) are proven
//   unaffected by this migration's default-on behaviour there; this file proves the OPT-OUT path,
//   which neither of those files has any way to exercise since notification_preferences didn't
//   exist when they were written.
// - migration 0014's sweep_overdue_tasks() SQL function, called directly via RPC exactly the way
//   pg_cron invokes it in production, against real rows: fires task_overdue for an overdue task
//   whose assignee has not opted out, is a no-op for one who has, and does not double-fire on a
//   second sweep of the same task (the notifications_task_overdue_once partial unique index,
//   already unit-proven at the RLS layer in tests/rls/notificationPreferences.spec.ts, proven here
//   end to end through the real deployed function instead of a hand-written query).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M4-8-Integration-Test-Pw1!";

let service: SupabaseClient;

const ids = {
  tenantId: "",
  practiceLineId: "",
  stageId: "",
  accountId: "",
  dealId: "",
  assignerAuthId: "",
  assigneeAuthId: "",
};

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

beforeAll(async () => {
  service = createServiceClient();

  ids.tenantId = await findOrCreateTenant(service, "m4-8-integration-test", "M4.8 Integration Test Tenant");

  ids.practiceLineId = await findOrCreateByUniqueMatch(
    service,
    "practice_lines",
    { tenant_id: ids.tenantId, code: "ADV" },
    { tenant_id: ids.tenantId, name: "Advisory", code: "ADV" },
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
    { tenant_id: ids.tenantId, name: "M4.8 Test Client" },
    { tenant_id: ids.tenantId, name: "M4.8 Test Client" },
  );

  ids.assignerAuthId = await findOrCreateUser(service, ids.tenantId, "m4-8-assigner@example.com", "M4.8 Assigner", PASSWORD);
  ids.assigneeAuthId = await findOrCreateUser(service, ids.tenantId, "m4-8-assignee@example.com", "M4.8 Assignee", PASSWORD);

  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  await service.from("user_roles").insert([
    { tenant_id: ids.tenantId, user_id: ids.assignerAuthId, role: "bde", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.assigneeAuthId, role: "bde", practice_line_id: ids.practiceLineId },
  ]);

  ids.dealId = await findOrCreateByUniqueMatch(
    service,
    "deals",
    { tenant_id: ids.tenantId, reference: "D-NOTIFPREF-1" },
    {
      tenant_id: ids.tenantId,
      reference: "D-NOTIFPREF-1",
      name: "Notification Preference Test Deal",
      account_id: ids.accountId,
      practice_line_id: ids.practiceLineId,
      stage_id: ids.stageId,
      client_type: "new",
      owner_id: ids.assignerAuthId,
      author_id: ids.assignerAuthId,
      status: "active",
      expected_close_date: "2027-06-01",
    },
  );

  // Fresh, deterministic state per run: soft-delete every prior task on this deal, and reset the
  // assignee's own preference rows back to "never set" (default-on) before each test decides what
  // it needs.
  await service.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("deal_id", ids.dealId).is("deleted_at", null);
  await service.from("notification_preferences").delete().eq("user_id", ids.assigneeAuthId);
});

afterAll(async () => {
  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
});

async function makeTaskAs(email: string, title: string, dueDate: string): Promise<string> {
  const client = await signIn(email);
  const session = await getSessionActor(client);
  if (session.status !== "active") throw new Error("expected an active session");
  const result = await createTask(client, session.actor, {
    dealId: ids.dealId,
    originActivityId: null,
    title,
    description: null,
    assigneeId: ids.assigneeAuthId,
    dueDate,
    priority: "normal",
  });
  if (!result.ok) throw new Error(`fixture createTask failed: ${result.code}`);
  return result.task.id;
}

describe("sendNotification's preference gate, end to end through createTask/assignTask", () => {
  it("getNotificationPreferences defaults every type to enabled when nothing has been set", async () => {
    const client = await signIn("m4-8-assignee@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const preferences = await getNotificationPreferences(client, session.actor);
    expect(preferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "task_assigned", enabled: true }),
        expect.objectContaining({ eventType: "task_reassigned", enabled: true }),
        expect.objectContaining({ eventType: "task_overdue", enabled: true }),
        expect.objectContaining({ eventType: "mentioned", enabled: true }),
      ]),
    );
  });

  it("a task_assigned notification is written by default (no preference row set)", async () => {
    const taskId = await makeTaskAs("m4-8-assigner@example.com", "Default-on assignment", "2027-01-01");

    const { data } = await service
      .from("notifications")
      .select("id")
      .eq("entity_id", taskId)
      .eq("event_type", "task_assigned")
      .eq("recipient_id", ids.assigneeAuthId);
    expect(data).toHaveLength(1);
  });

  it("opting out of task_assigned suppresses the notification on the next assignment", async () => {
    const client = await signIn("m4-8-assignee@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");
    await setNotificationPreference(client, session.actor, "task_assigned", false);

    const taskId = await makeTaskAs("m4-8-assigner@example.com", "Opted-out assignment", "2027-01-02");

    const { data } = await service.from("notifications").select("id").eq("entity_id", taskId).eq("event_type", "task_assigned");
    expect(data).toHaveLength(0);
  });

  it("opting back in resumes the notification", async () => {
    const client = await signIn("m4-8-assignee@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");
    await setNotificationPreference(client, session.actor, "task_assigned", true);

    const taskId = await makeTaskAs("m4-8-assigner@example.com", "Opted-back-in assignment", "2027-01-03");

    const { data } = await service.from("notifications").select("id").eq("entity_id", taskId).eq("event_type", "task_assigned");
    expect(data).toHaveLength(1);
  });

  it("opting out of task_reassigned suppresses assignTask's own notification", async () => {
    const client = await signIn("m4-8-assignee@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");
    await setNotificationPreference(client, session.actor, "task_reassigned", false);

    // A task first assigned to the assignee, reassigned off to the assigner, then reassigned back
    // to the assignee - assignTask is the reassignment path, not createTask's own first-assignment
    // path. task.reassign's own scope is "assigned" (docs/02-permission-matrix.md: "own_assigned"),
    // meaning only the CURRENT assignee may hand a task onward - not whoever originally assigned it
    // - so each hop below is performed by whoever currently holds the task, not by the assigner
    // unilaterally reclaiming it.
    const taskId = await makeTaskAs("m4-8-assigner@example.com", "To be reassigned", "2027-01-04");

    const assigneeClient = await signIn("m4-8-assignee@example.com");
    const assigneeSession = await getSessionActor(assigneeClient);
    if (assigneeSession.status !== "active") throw new Error("expected an active session");
    const back = await assignTask(assigneeClient, assigneeSession.actor, taskId, ids.assignerAuthId);
    if (!back.ok) throw new Error(`fixture reassign-to-assigner failed: ${back.code}`);

    const assignerClient = await signIn("m4-8-assigner@example.com");
    const assignerSession = await getSessionActor(assignerClient);
    if (assignerSession.status !== "active") throw new Error("expected an active session");
    const reassignResult = await assignTask(assignerClient, assignerSession.actor, taskId, ids.assigneeAuthId);
    expect(reassignResult.ok).toBe(true);

    // Scoped to the assignee as recipient specifically - the first hop (assignee handing the task
    // to the assigner) legitimately wrote its OWN task_reassigned notification, to the assigner, who
    // has opted out of nothing; only a notification recipient_id = the assignee is what this test's
    // opt-out should have suppressed.
    const { data } = await service
      .from("notifications")
      .select("id")
      .eq("entity_id", taskId)
      .eq("event_type", "task_reassigned")
      .eq("recipient_id", ids.assigneeAuthId);
    expect(data).toHaveLength(0);
  });
});

describe("sweep_overdue_tasks(), called via RPC exactly as pg_cron invokes it in production", () => {
  it("fires task_overdue for an overdue, open task whose assignee has not opted out", async () => {
    const taskId = await makeTaskAs("m4-8-assigner@example.com", "Sweep test - should fire", "2020-01-01");

    const { error } = await service.rpc("sweep_overdue_tasks");
    expect(error).toBeNull();

    const { data } = await service.from("notifications").select("id, recipient_id").eq("entity_id", taskId).eq("event_type", "task_overdue");
    expect(data).toHaveLength(1);
    expect(data![0]!.recipient_id).toBe(ids.assigneeAuthId);
  });

  it("does not fire a second time for the same task on a repeat sweep", async () => {
    const taskId = await makeTaskAs("m4-8-assigner@example.com", "Sweep test - no double fire", "2020-01-02");

    await service.rpc("sweep_overdue_tasks");
    await service.rpc("sweep_overdue_tasks");

    const { data } = await service.from("notifications").select("id").eq("entity_id", taskId).eq("event_type", "task_overdue");
    expect(data).toHaveLength(1);
  });

  it("does not fire for an assignee who has opted out of task_overdue", async () => {
    const client = await signIn("m4-8-assignee@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");
    await setNotificationPreference(client, session.actor, "task_overdue", false);

    const taskId = await makeTaskAs("m4-8-assigner@example.com", "Sweep test - opted out", "2020-01-03");
    await service.rpc("sweep_overdue_tasks");

    const { data } = await service.from("notifications").select("id").eq("entity_id", taskId).eq("event_type", "task_overdue");
    expect(data).toHaveLength(0);
  });
});
