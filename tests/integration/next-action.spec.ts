import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSessionActor } from "@/services/actor";
import { createTask } from "@/services/tasks";
import { getDealDetail } from "@/services/deals";
import { findOrCreateByUniqueMatch, findOrCreateTenant, findOrCreateUser, signIn as signInAs } from "./support/permanentFixture";

// M4.4 exit criteria (docs/07-build-backlog.md): "`next_action_task_id` derivation trigger; the
// next-action strip and the 'No next step' state on the deal header." Exercises migration 0013's
// refresh_deal_next_action() trigger end to end against the real hosted project, through the real
// createTask service (not raw SQL) and getDealDetail's own `nextAction` field - the same round trip
// the deal detail page actually uses.
//
// A real bug in db/schema.sql's own reference trigger was found and fixed while writing migration
// 0013 (see its own header comment): an `UPDATE ... FROM (subquery)` never clears the target columns
// back to null when the subquery returns zero rows, so a naive port of that function would leave
// next_action_task_id pointing at a task that is no longer open once the LAST open task on a deal
// closes. The final test in this file exists specifically to prove that case, not just the "still
// has an open task" happy path.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M4-4-Integration-Test-Pw1!";
const TIMEZONE = "Africa/Lagos";

let service: SupabaseClient;

const ids = {
  tenantId: "",
  practiceLineId: "",
  stageId: "",
  accountId: "",
  dealId: "",
  bdeAuthId: "",
};

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

beforeAll(async () => {
  service = createServiceClient();

  ids.tenantId = await findOrCreateTenant(service, "m4-4-integration-test", "M4.4 Integration Test Tenant");

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
    { tenant_id: ids.tenantId, name: "M4.4 Test Client" },
    { tenant_id: ids.tenantId, name: "M4.4 Test Client" },
  );

  ids.bdeAuthId = await findOrCreateUser(service, ids.tenantId, "m4-4-bde@example.com", "M4.4 Bde", PASSWORD);

  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  await service.from("user_roles").insert([{ tenant_id: ids.tenantId, user_id: ids.bdeAuthId, role: "bde", practice_line_id: ids.practiceLineId }]);

  await service.from("account_practice_owners").delete().eq("account_id", ids.accountId);
  await service
    .from("account_practice_owners")
    .insert({ account_id: ids.accountId, practice_line_id: ids.practiceLineId, owner_id: ids.bdeAuthId });

  ids.dealId = await findOrCreateByUniqueMatch(
    service,
    "deals",
    { tenant_id: ids.tenantId, reference: "D-NEXTACTION-1" },
    {
      tenant_id: ids.tenantId,
      reference: "D-NEXTACTION-1",
      name: "Next Action Integration Test Deal",
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

  // find-or-create reuses this deal across runs. Every task created by a prior run ends this
  // file's own suite marked 'done' (the last two tests complete every task they create), so the
  // deal always starts a fresh run with zero OPEN tasks and therefore a null nextAction - no
  // separate reset step is needed, and none is attempted: tasks are referenced by the immutable
  // task_assignments ledger (migration 0011), so deleting them here would fail on the second run
  // with a foreign-key violation, the same permanently-un-deletable shape this codebase's other
  // integration fixtures already document.
});

afterAll(async () => {
  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  // Deliberately not deleting tasks/the deal/account/stage/practice line/users/tenant - see this
  // file's header comment. beforeAll is find-or-create for all of these fixture rows.
});

async function completeTask(taskId: string) {
  const { error } = await service.from("tasks").update({ status: "done", completed_at: new Date().toISOString(), completed_by: ids.bdeAuthId }).eq("id", taskId);
  if (error) throw new Error(`fixture completeTask failed: ${error.message}`);
}

describe("refresh_deal_next_action, end to end against a real signed-in session and the real hosted project", () => {
  it("a deal with no open tasks has a null nextAction", async () => {
    const client = await signIn("m4-4-bde@example.com");
    const deal = await getDealDetail(client, ids.dealId, TIMEZONE);
    expect(deal?.nextAction).toBeNull();
  });

  it("creating a task sets nextAction to it", async () => {
    const client = await signIn("m4-4-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const created = await createTask(client, session.actor, {
      dealId: ids.dealId,
      originActivityId: null,
      title: "First open task",
      description: null,
      assigneeId: ids.bdeAuthId,
      dueDate: "2027-03-01",
      priority: "normal",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const deal = await getDealDetail(client, ids.dealId, TIMEZONE);
    expect(deal?.nextAction).toMatchObject({ taskId: created.task.id, title: "First open task", dueDate: "2027-03-01", priority: "normal" });
  });

  it("a task due EARLIER becomes the new nextAction, even though it was created second", async () => {
    const client = await signIn("m4-4-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const earlier = await createTask(client, session.actor, {
      dealId: ids.dealId,
      originActivityId: null,
      title: "Earlier task",
      description: null,
      assigneeId: ids.bdeAuthId,
      dueDate: "2027-02-01",
      priority: "high",
    });
    expect(earlier.ok).toBe(true);
    if (!earlier.ok) return;

    const deal = await getDealDetail(client, ids.dealId, TIMEZONE);
    expect(deal?.nextAction).toMatchObject({ taskId: earlier.task.id, dueDate: "2027-02-01" });
  });

  it("completing the earliest task falls back to the next-earliest remaining open task", async () => {
    const client = await signIn("m4-4-bde@example.com");
    const deal = await getDealDetail(client, ids.dealId, TIMEZONE);
    const earliestTaskId = deal!.nextAction!.taskId;

    await completeTask(earliestTaskId);

    const after = await getDealDetail(client, ids.dealId, TIMEZONE);
    expect(after?.nextAction).not.toBeNull();
    expect(after?.nextAction?.taskId).not.toBe(earliestTaskId);
    expect(after?.nextAction?.dueDate).toBe("2027-03-01");
  });

  it("completing the LAST remaining open task clears nextAction back to null - the bug this migration fixes", async () => {
    const client = await signIn("m4-4-bde@example.com");
    const deal = await getDealDetail(client, ids.dealId, TIMEZONE);
    const lastTaskId = deal!.nextAction!.taskId;

    await completeTask(lastTaskId);

    const after = await getDealDetail(client, ids.dealId, TIMEZONE);
    expect(after?.nextAction).toBeNull();
  });
});
