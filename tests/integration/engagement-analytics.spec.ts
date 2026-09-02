import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSessionActor } from "@/services/actor";
import { getEngagementAnalytics } from "@/services/reports";
import { findOrCreateByUniqueMatch, findOrCreateTenant, findOrCreateUser, signIn as signInAs } from "./support/permanentFixture";

// M6.5 exit criteria (docs/07-build-backlog.md): "Engagement analytics: coverage, volume by type
// paired with conversion, logging latency, time to first engagement, next-action coverage — all
// role-scoped." Proves docs/04-metric-definitions.md's five metrics end to end, against the real
// hosted project through real signed-in sessions, with the one thing no earlier M6.x panel needed to
// prove: a "team" scope genuinely narrower than "practice" (migration 0021's manager_id,
// docs/DECISIONS.md D-18) - a team_lead whose direct reports (bde1) differ from the whole practice
// (bde1 + bde2, the latter unassigned to any manager).
//
// Fixture shape, deliberately layered to prove every scope boundary at once rather than one at a
// time: bde1 (reports to teamLead) owns two deals in ADV - one with a recent client-facing activity
// and an open next-action task (covered), one with only a stale client-facing activity and no open
// task (uncovered) - so engagement coverage and next-action coverage both read a real 50%, not a
// trivial 100%/0%. bde2 (same practice, no manager) owns a third ADV deal, invisible to teamLead's
// own "team" scope but visible to director's "practice" scope - the exact boundary this milestone
// exists to prove. otherBde (a second practice, OPS) owns a fourth deal, invisible to director's
// practice scope but visible to executive's tenant scope. bde3 has zero deals at all, proving the
// insufficient_data floor at n=0 without ever being denied (analytics.view_own, unlike
// analytics.view_practice, is never denied for a bde).
//
// deals/activities/tasks are all permanently un-deletable once seeded (a deal with a child
// stage_events row can't be deleted; activities/tasks have no delete policy for `authenticated` and
// this fixture reuses the service role, but find-or-create keeps every re-run idempotent regardless
// - the same reasoning tests/integration/time-in-stage.spec.ts's own header comment already gives).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M6-5-Integration-Test-Pw1!";

let service: SupabaseClient;

const ids = {
  tenantId: "",
  advPracticeLineId: "",
  opsPracticeLineId: "",
  accountId: "",
  stageId: "",
  execAuthId: "",
  directorAuthId: "",
  teamLeadAuthId: "",
  bde1AuthId: "",
  bde2AuthId: "",
  bde3AuthId: "",
  otherBdeAuthId: "",
  coveredDealId: "",
  uncoveredDealId: "",
  bde2DealId: "",
  otherDealId: "",
};

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

function daysAgoDate(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
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

async function findOrCreateActivity(
  dealId: string,
  summary: string,
  type: string,
  activityDate: string,
  authorId: string,
  outcomeDisposition: string | null,
): Promise<void> {
  const { data: existing } = await service.from("activities").select("id").eq("deal_id", dealId).eq("summary", summary).maybeSingle();
  if (existing) return;

  const { error } = await service.from("activities").insert({
    tenant_id: ids.tenantId,
    deal_id: dealId,
    type,
    activity_date: activityDate,
    summary,
    author_id: authorId,
    outcome_disposition: outcomeDisposition,
  });
  if (error) throw new Error(`seed activity "${summary}" for deal ${dealId} failed: ${error.message}`);
}

async function findOrCreateOpenTask(dealId: string, title: string, assigneeId: string): Promise<void> {
  const { data: existing } = await service.from("tasks").select("id").eq("deal_id", dealId).eq("title", title).maybeSingle();
  if (existing) return;

  const { error } = await service.from("tasks").insert({
    tenant_id: ids.tenantId,
    deal_id: dealId,
    title,
    assignee_id: assigneeId,
    assigned_by: assigneeId,
    due_date: "2027-01-01",
    status: "open",
  });
  if (error) throw new Error(`seed task "${title}" for deal ${dealId} failed: ${error.message}`);
}

beforeAll(async () => {
  service = createServiceClient();

  ids.tenantId = await findOrCreateTenant(service, "m6-5-engagement-test", "M6.5 Engagement Analytics Test Tenant");
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
    { tenant_id: ids.tenantId, name: "M6.5 Engagement Test Client" },
    { tenant_id: ids.tenantId, name: "M6.5 Engagement Test Client" },
  );
  ids.stageId = await findOrCreateByUniqueMatch(
    service,
    "pipeline_stages",
    { tenant_id: ids.tenantId, code: "DISCOVERY" },
    { tenant_id: ids.tenantId, name: "Discovery", code: "DISCOVERY", sort_order: 1, probability_threshold: 20, stage_type: "open" },
  );

  ids.execAuthId = await findOrCreateUser(service, ids.tenantId, "m6-5-ea-exec@example.com", "M6.5 EA Exec", PASSWORD);
  ids.directorAuthId = await findOrCreateUser(service, ids.tenantId, "m6-5-ea-director@example.com", "M6.5 EA Director", PASSWORD);
  ids.teamLeadAuthId = await findOrCreateUser(service, ids.tenantId, "m6-5-ea-team-lead@example.com", "M6.5 EA Team Lead", PASSWORD);
  ids.bde1AuthId = await findOrCreateUser(service, ids.tenantId, "m6-5-ea-bde1@example.com", "M6.5 EA Bde1", PASSWORD);
  ids.bde2AuthId = await findOrCreateUser(service, ids.tenantId, "m6-5-ea-bde2@example.com", "M6.5 EA Bde2", PASSWORD);
  ids.bde3AuthId = await findOrCreateUser(service, ids.tenantId, "m6-5-ea-bde3@example.com", "M6.5 EA Bde3", PASSWORD);
  ids.otherBdeAuthId = await findOrCreateUser(service, ids.tenantId, "m6-5-ea-other-bde@example.com", "M6.5 EA Other Bde", PASSWORD);

  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  // The team_lead's own row must be committed before bde1's row is inserted with manager_id set to
  // it - migration 0021's validate_user_roles_manager() trigger looks it up by tenant/practice/role,
  // so this is split into two statements rather than relying on same-statement row-insertion order.
  const { error: leaderRoleError } = await service.from("user_roles").insert([
    { tenant_id: ids.tenantId, user_id: ids.execAuthId, role: "executive", practice_line_id: null },
    { tenant_id: ids.tenantId, user_id: ids.directorAuthId, role: "director", practice_line_id: ids.advPracticeLineId },
    { tenant_id: ids.tenantId, user_id: ids.teamLeadAuthId, role: "team_lead", practice_line_id: ids.advPracticeLineId },
  ]);
  if (leaderRoleError) throw new Error(`fixture leader role grant failed: ${leaderRoleError.message}`);

  const { error: roleError } = await service.from("user_roles").insert([
    { tenant_id: ids.tenantId, user_id: ids.bde1AuthId, role: "bde", practice_line_id: ids.advPracticeLineId, manager_id: ids.teamLeadAuthId },
    { tenant_id: ids.tenantId, user_id: ids.bde2AuthId, role: "bde", practice_line_id: ids.advPracticeLineId },
    { tenant_id: ids.tenantId, user_id: ids.bde3AuthId, role: "bde", practice_line_id: ids.advPracticeLineId },
    { tenant_id: ids.tenantId, user_id: ids.otherBdeAuthId, role: "bde", practice_line_id: ids.opsPracticeLineId },
  ]);
  if (roleError) throw new Error(`fixture role grant failed: ${roleError.message}`);

  ids.coveredDealId = await findOrCreateDeal("D-6-5-EA-COVERED", ids.advPracticeLineId, ids.bde1AuthId);
  ids.uncoveredDealId = await findOrCreateDeal("D-6-5-EA-UNCOVERED", ids.advPracticeLineId, ids.bde1AuthId);
  ids.bde2DealId = await findOrCreateDeal("D-6-5-EA-BDE2", ids.advPracticeLineId, ids.bde2AuthId);
  ids.otherDealId = await findOrCreateDeal("D-6-5-EA-OTHER", ids.opsPracticeLineId, ids.otherBdeAuthId);

  // coveredDealId: one client-facing activity 5 days ago (inside the trailing-14-day window) with a
  // disposition, one non-client-facing activity with no disposition (proves noDispositionCount and
  // that "note" never counts toward coverage), plus an open next-action task.
  await findOrCreateActivity(ids.coveredDealId, "M6.5 EA covered call", "call", daysAgoDate(5), ids.bde1AuthId, "positive");
  await findOrCreateActivity(ids.coveredDealId, "M6.5 EA covered note", "note", daysAgoDate(5), ids.bde1AuthId, null);
  await findOrCreateOpenTask(ids.coveredDealId, "M6.5 EA next step", ids.bde1AuthId);

  // uncoveredDealId: only a client-facing activity 20 days ago (outside the window) - contributes to
  // activeDealCount but not coveredDealCount, and has no open task.
  await findOrCreateActivity(ids.uncoveredDealId, "M6.5 EA uncovered call", "call", daysAgoDate(20), ids.bde1AuthId, "neutral");
});

afterAll(async () => {
  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
});

describe("getEngagementAnalytics, end to end against a real signed-in session", () => {
  it("a bde (own scope) sees only their own two deals, with a real 50% coverage and 50% next-action rate", async () => {
    const client = await signIn("m6-5-ea-bde1@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await getEngagementAnalytics(client, session.actor, "Africa/Lagos");
    expect(result.scope).toBe("own");
    expect(result.coverage.activeDealCount).toBe(2);
    expect(result.coverage.coveredDealCount).toBe(1);
    expect(result.coverage.coverageRate).toEqual({ status: "ok", value: 0.5, sampleSize: 2 });
    expect(result.nextActionCoverage).toEqual({ activeDealCount: 2, withNextActionCount: 1, coverageRate: { status: "ok", value: 0.5, sampleSize: 2 } });

    const callVolume = result.volumeByType.find((v) => v.type === "call");
    expect(callVolume?.count).toBe(2);
    expect(callVolume?.dispositionCounts.positive).toBe(1);
    expect(callVolume?.dispositionCounts.neutral).toBe(1);
    const noteVolume = result.volumeByType.find((v) => v.type === "note");
    expect(noteVolume?.count).toBe(1);
    expect(noteVolume?.noDispositionCount).toBe(1);
    // every one of the 8 known types is listed, including ones with zero activities in scope
    expect(result.volumeByType).toHaveLength(8);
    expect(result.volumeByType.find((v) => v.type === "meeting")?.count).toBe(0);
  });

  it("a team_lead (team scope) sees bde1's deals but not bde2's, even though both are in the same practice (D-18)", async () => {
    const client = await signIn("m6-5-ea-team-lead@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await getEngagementAnalytics(client, session.actor, "Africa/Lagos");
    expect(result.scope).toBe("team");
    // bde1's 2 deals plus self (the team_lead owns none) - not bde2's 3rd ADV deal
    expect(result.coverage.activeDealCount).toBe(2);
  });

  it("a director (practice scope) sees bde1's and bde2's deals, but not the other practice's deal", async () => {
    const client = await signIn("m6-5-ea-director@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await getEngagementAnalytics(client, session.actor, "Africa/Lagos");
    expect(result.scope).toBe("practice");
    expect(result.coverage.activeDealCount).toBe(3);
  });

  it("an executive (tenant scope) sees every deal across both practices", async () => {
    const client = await signIn("m6-5-ea-exec@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await getEngagementAnalytics(client, session.actor, "Africa/Lagos");
    expect(result.scope).toBe("tenant");
    expect(result.coverage.activeDealCount).toBe(4);
  });

  it("a bde with zero deals reads insufficient_data on every ratio/average, never denied (analytics.view_own)", async () => {
    const client = await signIn("m6-5-ea-bde3@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await getEngagementAnalytics(client, session.actor, "Africa/Lagos");
    expect(result.scope).toBe("own");
    expect(result.coverage.activeDealCount).toBe(0);
    expect(result.coverage.coverageRate).toEqual({ status: "insufficient_data", sampleSize: 0, minimumRequired: 1 });
    expect(result.nextActionCoverage.coverageRate).toEqual({ status: "insufficient_data", sampleSize: 0, minimumRequired: 1 });
    expect(result.loggingLatencyDays).toEqual({ status: "insufficient_data", sampleSize: 0, minimumRequired: 1 });
    expect(result.timeToFirstEngagementDays).toEqual({ status: "insufficient_data", sampleSize: 0, minimumRequired: 1 });
    expect(result.volumeByType.every((v) => v.count === 0)).toBe(true);
  });
});
