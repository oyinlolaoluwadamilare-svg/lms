import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSessionActor } from "@/services/actor";
import { getTaskAnalytics } from "@/services/reports";
import { findOrCreateByUniqueMatch, findOrCreateTenant, findOrCreateUser, signIn as signInAs } from "./support/permanentFixture";

// M6.6 exit criteria (docs/07-build-backlog.md): "Task analytics: on-time rate excluding
// cancellations, overdue counts, delegation load." Proves docs/04-metric-definitions.md's three
// formulas end to end, against the real hosted project through real signed-in sessions, reusing the
// exact own/team/practice/tenant scope model M6.1/M6.5 already established (docs/DECISIONS.md D-19)
// - a team_lead's own team (bde1, via migration 0021's manager_id) differs from the whole practice
// (bde1 + bde2), the same boundary tests/integration/engagement-analytics.spec.ts already proves for
// deals, now proved for tasks.
//
// Fixture shape: bde1 (reports to teamLead) is assigned five tasks, all linked to one ADV deal - one
// completed on time, one completed late, one cancelled (must never count as "completed" at all,
// proving the doc's own "excludes cancelled tasks" caveat needs no separate filter), one open and
// overdue, one open and not yet due. bde2 (same practice, no manager) has one open, overdue task on
// the SAME ADV deal - invisible to teamLead's own "team" scope but visible to director's "practice"
// scope, and has zero completed tasks, proving the insufficient_data floor at n=0 without ever being
// denied. otherBde (a second practice, OPS, its own deal) has one open, overdue task - invisible to
// director's practice scope but visible to executive's tenant scope. teamLead/director themselves
// have no tasks assigned at all, proving delegation load lists only assignees who actually hold an
// open task, never a zero-count row for someone with none.
//
// Deliberately tied to a real deal, not deal-less: `tasks_select`'s own RLS policy (migration 0011)
// grants team_lead/director practice-wide visibility ONLY through `deal_id is not null and
// deal_practice_line_id(deal_id) in entitled_practices()` - a deal-less personal task stays invisible
// to anyone but its own assignee/assigner and tenant_admin/executive, the exact privacy boundary
// `getTeamTaskCounts` (M4.6, src/data/tasks.ts) already documents and accepts. `getTaskAnalytics`
// reads through the caller's own RLS-scoped session, the same "RLS coarse, service precise" split
// every other M6.x metric already uses - so this fixture attaches every task to a real deal, the
// overwhelmingly common real-world case, rather than exercising the separate deal-less-task privacy
// boundary this milestone isn't about.
//
// Tasks/deals are permanently un-deletable in spirit here (no delete policy for `authenticated`, and
// this fixture reuses the service role) - find-or-create throughout, the same reasoning
// tests/integration/time-in-stage.spec.ts's own header comment already gives.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M6-6-Integration-Test-Pw1!";

let service: SupabaseClient;

const ids = {
  tenantId: "",
  advPracticeLineId: "",
  opsPracticeLineId: "",
  accountId: "",
  stageId: "",
  advDealId: "",
  opsDealId: "",
  execAuthId: "",
  directorAuthId: "",
  teamLeadAuthId: "",
  bde1AuthId: "",
  bde2AuthId: "",
  otherBdeAuthId: "",
};

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

function daysAgoDate(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function daysFromNowDate(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function findOrCreateDeal(reference: string, practiceLineId: string, ownerId: string): Promise<string> {
  return findOrCreateByUniqueMatch(
    service,
    "deals",
    { tenant_id: ids.tenantId, reference },
    {
      tenant_id: ids.tenantId,
      reference,
      name: reference,
      account_id: ids.accountId,
      practice_line_id: practiceLineId,
      stage_id: ids.stageId,
      client_type: "new",
      owner_id: ownerId,
      author_id: ownerId,
      status: "active",
      expected_close_date: "2027-06-01",
    },
  );
}

async function findOrCreateTask(
  title: string,
  dealId: string,
  assigneeId: string,
  status: "open" | "in_progress" | "blocked" | "done" | "cancelled",
  dueDate: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const { data: existing } = await service.from("tasks").select("id").eq("tenant_id", ids.tenantId).eq("title", title).maybeSingle();
  if (existing) return;

  const { error } = await service.from("tasks").insert({
    tenant_id: ids.tenantId,
    deal_id: dealId,
    title,
    assignee_id: assigneeId,
    assigned_by: assigneeId,
    due_date: dueDate,
    status,
    ...extra,
  });
  if (error) throw new Error(`seed task "${title}" failed: ${error.message}`);
}

beforeAll(async () => {
  service = createServiceClient();

  ids.tenantId = await findOrCreateTenant(service, "m6-6-task-analytics-test", "M6.6 Task Analytics Test Tenant");
  ids.advPracticeLineId = await findOrCreateByUniqueMatch(
    service,
    "practice_lines",
    { tenant_id: ids.tenantId, code: "ADV" },
    { tenant_id: ids.tenantId, name: "Advisory", code: "ADV" },
  );
  ids.opsPracticeLineId = await findOrCreateByUniqueMatch(
    service,
    "practice_lines",
    { tenant_id: ids.tenantId, code: "OPS" },
    { tenant_id: ids.tenantId, name: "Outsourcing", code: "OPS" },
  );
  ids.accountId = await findOrCreateByUniqueMatch(
    service,
    "accounts",
    { tenant_id: ids.tenantId, name: "M6.6 Task Analytics Test Client" },
    { tenant_id: ids.tenantId, name: "M6.6 Task Analytics Test Client" },
  );
  ids.stageId = await findOrCreateByUniqueMatch(
    service,
    "pipeline_stages",
    { tenant_id: ids.tenantId, code: "DISCOVERY" },
    { tenant_id: ids.tenantId, name: "Discovery", code: "DISCOVERY", sort_order: 1, probability_threshold: 20, stage_type: "open" },
  );

  ids.execAuthId = await findOrCreateUser(service, ids.tenantId, "m6-6-ta-exec@example.com", "M6.6 TA Exec", PASSWORD);
  ids.directorAuthId = await findOrCreateUser(service, ids.tenantId, "m6-6-ta-director@example.com", "M6.6 TA Director", PASSWORD);
  ids.teamLeadAuthId = await findOrCreateUser(service, ids.tenantId, "m6-6-ta-team-lead@example.com", "M6.6 TA Team Lead", PASSWORD);
  ids.bde1AuthId = await findOrCreateUser(service, ids.tenantId, "m6-6-ta-bde1@example.com", "M6.6 TA Bde1", PASSWORD);
  ids.bde2AuthId = await findOrCreateUser(service, ids.tenantId, "m6-6-ta-bde2@example.com", "M6.6 TA Bde2", PASSWORD);
  ids.otherBdeAuthId = await findOrCreateUser(service, ids.tenantId, "m6-6-ta-other-bde@example.com", "M6.6 TA Other Bde", PASSWORD);

  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  const { error: leaderRoleError } = await service.from("user_roles").insert([
    { tenant_id: ids.tenantId, user_id: ids.execAuthId, role: "executive", practice_line_id: null },
    { tenant_id: ids.tenantId, user_id: ids.directorAuthId, role: "director", practice_line_id: ids.advPracticeLineId },
    { tenant_id: ids.tenantId, user_id: ids.teamLeadAuthId, role: "team_lead", practice_line_id: ids.advPracticeLineId },
  ]);
  if (leaderRoleError) throw new Error(`fixture leader role grant failed: ${leaderRoleError.message}`);

  const { error: roleError } = await service.from("user_roles").insert([
    { tenant_id: ids.tenantId, user_id: ids.bde1AuthId, role: "bde", practice_line_id: ids.advPracticeLineId, manager_id: ids.teamLeadAuthId },
    { tenant_id: ids.tenantId, user_id: ids.bde2AuthId, role: "bde", practice_line_id: ids.advPracticeLineId },
    { tenant_id: ids.tenantId, user_id: ids.otherBdeAuthId, role: "bde", practice_line_id: ids.opsPracticeLineId },
  ]);
  if (roleError) throw new Error(`fixture role grant failed: ${roleError.message}`);

  ids.advDealId = await findOrCreateDeal("D-6-6-TA-ADV", ids.advPracticeLineId, ids.bde1AuthId);
  ids.opsDealId = await findOrCreateDeal("D-6-6-TA-OPS", ids.opsPracticeLineId, ids.otherBdeAuthId);

  // bde1: 2 completed (1 on time, 1 late), 1 cancelled (must never count as completed), 1 open
  // overdue, 1 open not-yet-due.
  await findOrCreateTask("M6.6 TA bde1 on-time", ids.advDealId, ids.bde1AuthId, "done", "2026-01-10", {
    completed_at: "2026-01-09T10:00:00Z",
    completed_by: ids.bde1AuthId,
  });
  await findOrCreateTask("M6.6 TA bde1 late", ids.advDealId, ids.bde1AuthId, "done", "2026-01-10", {
    completed_at: "2026-01-12T10:00:00Z",
    completed_by: ids.bde1AuthId,
  });
  await findOrCreateTask("M6.6 TA bde1 cancelled", ids.advDealId, ids.bde1AuthId, "cancelled", "2026-01-10");
  await findOrCreateTask("M6.6 TA bde1 overdue", ids.advDealId, ids.bde1AuthId, "open", daysAgoDate(5));
  await findOrCreateTask("M6.6 TA bde1 not yet due", ids.advDealId, ids.bde1AuthId, "in_progress", daysFromNowDate(5));

  // bde2: 1 open, overdue task, zero completed - same practice as bde1, no manager assigned.
  await findOrCreateTask("M6.6 TA bde2 overdue", ids.advDealId, ids.bde2AuthId, "open", daysAgoDate(2));

  // otherBde: a second practice (OPS), its own deal - 1 open, overdue, blocked task.
  await findOrCreateTask("M6.6 TA other-bde overdue", ids.opsDealId, ids.otherBdeAuthId, "blocked", daysAgoDate(1), {
    blocked_reason: "Waiting on client sign-off",
  });
});

afterAll(async () => {
  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
});

describe("getTaskAnalytics, end to end against a real signed-in session", () => {
  it("a bde (own scope) sees a real 50% on-time rate, the cancelled task never counted, and their own overdue/delegation counts", async () => {
    const client = await signIn("m6-6-ta-bde1@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await getTaskAnalytics(client, session.actor, "Africa/Lagos");
    expect(result.scope).toBe("own");
    expect(result.completedCount).toBe(2); // not 3 - the cancelled task is never "completed"
    expect(result.onTimeCount).toBe(1);
    expect(result.onTimeRate).toEqual({ status: "ok", value: 0.5, sampleSize: 2 });
    expect(result.overdueCount).toBe(1); // the not-yet-due task doesn't count
    expect(result.delegationLoad).toEqual([{ assigneeId: ids.bde1AuthId, assigneeName: "M6.6 TA Bde1", openCount: 2 }]);
  });

  it("a bde with zero completed tasks reads insufficient_data on on-time rate, never denied (analytics.view_own)", async () => {
    const client = await signIn("m6-6-ta-bde2@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await getTaskAnalytics(client, session.actor, "Africa/Lagos");
    expect(result.scope).toBe("own");
    expect(result.completedCount).toBe(0);
    expect(result.onTimeRate).toEqual({ status: "insufficient_data", sampleSize: 0, minimumRequired: 1 });
    expect(result.overdueCount).toBe(1);
  });

  it("a team_lead (team scope) sees bde1's tasks but not bde2's, even though both are in the same practice (D-18/D-19)", async () => {
    const client = await signIn("m6-6-ta-team-lead@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await getTaskAnalytics(client, session.actor, "Africa/Lagos");
    expect(result.scope).toBe("team");
    expect(result.completedCount).toBe(2);
    expect(result.overdueCount).toBe(1);
    // only bde1 appears - the team_lead has no tasks of their own, and bde2 isn't a direct report
    expect(result.delegationLoad).toEqual([{ assigneeId: ids.bde1AuthId, assigneeName: "M6.6 TA Bde1", openCount: 2 }]);
  });

  it("a director (practice scope) sees bde1's and bde2's tasks, but not the other practice's", async () => {
    const client = await signIn("m6-6-ta-director@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await getTaskAnalytics(client, session.actor, "Africa/Lagos");
    expect(result.scope).toBe("practice");
    expect(result.completedCount).toBe(2);
    expect(result.overdueCount).toBe(2); // bde1's 1 + bde2's 1, not otherBde's
    expect(result.delegationLoad).toEqual([
      { assigneeId: ids.bde1AuthId, assigneeName: "M6.6 TA Bde1", openCount: 2 },
      { assigneeId: ids.bde2AuthId, assigneeName: "M6.6 TA Bde2", openCount: 1 },
    ]);
  });

  it("an executive (tenant scope) sees every practice's overdue/delegation counts", async () => {
    const client = await signIn("m6-6-ta-exec@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await getTaskAnalytics(client, session.actor, "Africa/Lagos");
    expect(result.scope).toBe("tenant");
    expect(result.overdueCount).toBe(3);
    expect(result.delegationLoad).toEqual(
      expect.arrayContaining([
        { assigneeId: ids.bde1AuthId, assigneeName: "M6.6 TA Bde1", openCount: 2 },
        { assigneeId: ids.bde2AuthId, assigneeName: "M6.6 TA Bde2", openCount: 1 },
        { assigneeId: ids.otherBdeAuthId, assigneeName: "M6.6 TA Other Bde", openCount: 1 },
      ]),
    );
  });
});
