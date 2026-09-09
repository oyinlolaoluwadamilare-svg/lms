import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSessionActor } from "@/services/actor";
import { getStageRegressionReport } from "@/services/reports";
import { findOrCreateByUniqueMatch, findOrCreateTenant, findOrCreateUser, signIn as signInAs } from "./support/permanentFixture";

// M6.7 exit criteria (docs/07-build-backlog.md): "Stage regression report." Proves
// docs/04-metric-definitions.md's "Stage regression rate" end to end, against the real hosted
// project through real signed-in sessions, reusing the exact own/team/practice/tenant scope model
// M6.5/M6.6 already established (docs/DECISIONS.md D-20) - a team_lead's own team (bde1, via
// migration 0021's manager_id) differs from the whole practice (bde1 + bde2), the same boundary
// tests/integration/engagement-analytics.spec.ts and tests/integration/task-analytics.spec.ts already
// prove for deals/tasks, now proved for stage regressions.
//
// Fixture shape: three sequential stages (Discovery sort 1, Proposal sort 2, Negotiation sort 3) -
// pipeline_stages is tenant-wide, not practice-scoped (migration 0005), so both practices share the
// same three. bde1 (reports to teamLead) owns three ADV deals: one that regressed for real
// (Negotiation -> Proposal, a real is_regression=true event), one that never regressed (a plain
// forward Proposal -> Negotiation transition), and one whose only regression event is
// is_reconstructed=true - proving D-20's own extension of D-16 (reconstructed rows never count, even
// though the trigger still computes is_regression=true for them). bde2 (same practice, no manager)
// owns one more ADV deal with a real regression - invisible to teamLead's own "team" scope but
// visible to director's "practice" scope. otherBde (a second practice, OPS) owns one more deal with a
// real regression - invisible to director's practice scope but visible to executive's tenant scope.
// bde3 has zero deals at all, proving the insufficient_data floor at n=0 without ever being denied
// (analytics.view_own, unlike analytics.view_practice, is never denied for a bde).
//
// Deals/stage_events are permanently un-deletable in spirit here (a deal with a child stage_events
// row can't be deleted, and stage_events has no delete policy for `authenticated` at all) - this
// fixture reuses the service role and find-or-create throughout, the same reasoning
// tests/integration/time-in-stage.spec.ts's own header comment already gives. Deals are created
// directly into their intended CURRENT stage (stage_events rows are seeded separately, purely for the
// historical record this metric reads) rather than replaying every real transition - the same
// simplification tests/integration/time-in-stage.spec.ts's own "reconstructed-only" deal fixture
// already uses, since inserting stage_events directly via the service client does not itself move
// deals.stage_id (that's changeStage's own application-level job, not exercised here).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M6-7-Integration-Test-Pw1!";

let service: SupabaseClient;

const ids = {
  tenantId: "",
  advPracticeLineId: "",
  opsPracticeLineId: "",
  accountId: "",
  discoveryStageId: "",
  proposalStageId: "",
  negotiationStageId: "",
  execAuthId: "",
  directorAuthId: "",
  teamLeadAuthId: "",
  bde1AuthId: "",
  bde2AuthId: "",
  bde3AuthId: "",
  otherBdeAuthId: "",
  regressedDealId: "",
  notRegressedDealId: "",
  reconstructedDealId: "",
  bde2DealId: "",
  otherDealId: "",
};

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

async function findOrCreateDeal(reference: string, practiceLineId: string, ownerId: string, stageId: string): Promise<string> {
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
      stage_id: stageId,
      client_type: "new",
      owner_id: ownerId,
      author_id: ownerId,
      status: "active",
      expected_close_date: "2027-06-01",
    },
  );
}

async function findOrCreateStageEvent(
  dealId: string,
  fromStageId: string,
  toStageId: string,
  occurredAt: string,
  isReconstructed = false,
): Promise<void> {
  const { data: existing } = await service.from("stage_events").select("id").eq("deal_id", dealId).eq("to_stage_id", toStageId).maybeSingle();
  if (existing) return;

  const { error } = await service.from("stage_events").insert({
    tenant_id: ids.tenantId,
    deal_id: dealId,
    from_stage_id: fromStageId,
    to_stage_id: toStageId,
    actor_id: ids.bde1AuthId,
    occurred_at: occurredAt,
    is_reconstructed: isReconstructed,
  });
  if (error) throw new Error(`seed stage_event for deal ${dealId} -> ${toStageId} failed: ${error.message}`);
}

beforeAll(async () => {
  service = createServiceClient();

  ids.tenantId = await findOrCreateTenant(service, "m6-7-stage-regression-test", "M6.7 Stage Regression Test Tenant");
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
    { tenant_id: ids.tenantId, name: "M6.7 Stage Regression Test Client" },
    { tenant_id: ids.tenantId, name: "M6.7 Stage Regression Test Client" },
  );
  ids.discoveryStageId = await findOrCreateByUniqueMatch(
    service,
    "pipeline_stages",
    { tenant_id: ids.tenantId, code: "DISCOVERY" },
    { tenant_id: ids.tenantId, name: "Discovery", code: "DISCOVERY", sort_order: 1, probability_threshold: 10, stage_type: "open" },
  );
  ids.proposalStageId = await findOrCreateByUniqueMatch(
    service,
    "pipeline_stages",
    { tenant_id: ids.tenantId, code: "PROPOSAL" },
    { tenant_id: ids.tenantId, name: "Proposal", code: "PROPOSAL", sort_order: 2, probability_threshold: 50, stage_type: "open" },
  );
  ids.negotiationStageId = await findOrCreateByUniqueMatch(
    service,
    "pipeline_stages",
    { tenant_id: ids.tenantId, code: "NEGOTIATION" },
    { tenant_id: ids.tenantId, name: "Negotiation", code: "NEGOTIATION", sort_order: 3, probability_threshold: 75, stage_type: "open" },
  );

  ids.execAuthId = await findOrCreateUser(service, ids.tenantId, "m6-7-sr-exec@example.com", "M6.7 SR Exec", PASSWORD);
  ids.directorAuthId = await findOrCreateUser(service, ids.tenantId, "m6-7-sr-director@example.com", "M6.7 SR Director", PASSWORD);
  ids.teamLeadAuthId = await findOrCreateUser(service, ids.tenantId, "m6-7-sr-team-lead@example.com", "M6.7 SR Team Lead", PASSWORD);
  ids.bde1AuthId = await findOrCreateUser(service, ids.tenantId, "m6-7-sr-bde1@example.com", "M6.7 SR Bde1", PASSWORD);
  ids.bde2AuthId = await findOrCreateUser(service, ids.tenantId, "m6-7-sr-bde2@example.com", "M6.7 SR Bde2", PASSWORD);
  ids.bde3AuthId = await findOrCreateUser(service, ids.tenantId, "m6-7-sr-bde3@example.com", "M6.7 SR Bde3", PASSWORD);
  ids.otherBdeAuthId = await findOrCreateUser(service, ids.tenantId, "m6-7-sr-other-bde@example.com", "M6.7 SR Other Bde", PASSWORD);

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
    { tenant_id: ids.tenantId, user_id: ids.bde3AuthId, role: "bde", practice_line_id: ids.advPracticeLineId },
    { tenant_id: ids.tenantId, user_id: ids.otherBdeAuthId, role: "bde", practice_line_id: ids.opsPracticeLineId },
  ]);
  if (roleError) throw new Error(`fixture role grant failed: ${roleError.message}`);

  // bde1: one real regression (currently sitting back in Proposal), one plain forward move (no
  // regression), one whose only regression event is reconstructed (must never count).
  ids.regressedDealId = await findOrCreateDeal("D-6-7-SR-REGRESSED", ids.advPracticeLineId, ids.bde1AuthId, ids.proposalStageId);
  await findOrCreateStageEvent(ids.regressedDealId, ids.negotiationStageId, ids.proposalStageId, "2026-02-01T00:00:00Z");

  ids.notRegressedDealId = await findOrCreateDeal("D-6-7-SR-NOT-REGRESSED", ids.advPracticeLineId, ids.bde1AuthId, ids.negotiationStageId);
  await findOrCreateStageEvent(ids.notRegressedDealId, ids.proposalStageId, ids.negotiationStageId, "2026-02-01T00:00:00Z");

  ids.reconstructedDealId = await findOrCreateDeal("D-6-7-SR-RECONSTRUCTED", ids.advPracticeLineId, ids.bde1AuthId, ids.proposalStageId);
  await findOrCreateStageEvent(ids.reconstructedDealId, ids.negotiationStageId, ids.proposalStageId, "2026-02-01T00:00:00Z", true);

  // bde2: one real regression - same practice as bde1, no manager assigned.
  ids.bde2DealId = await findOrCreateDeal("D-6-7-SR-BDE2", ids.advPracticeLineId, ids.bde2AuthId, ids.proposalStageId);
  await findOrCreateStageEvent(ids.bde2DealId, ids.negotiationStageId, ids.proposalStageId, "2026-02-02T00:00:00Z");

  // otherBde: a second practice (OPS) - one real regression.
  ids.otherDealId = await findOrCreateDeal("D-6-7-SR-OTHER", ids.opsPracticeLineId, ids.otherBdeAuthId, ids.proposalStageId);
  await findOrCreateStageEvent(ids.otherDealId, ids.negotiationStageId, ids.proposalStageId, "2026-02-03T00:00:00Z");
});

afterAll(async () => {
  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
});

describe("getStageRegressionReport, end to end against a real signed-in session", () => {
  it("a bde (own scope) sees a real 1-of-3 regression rate, the reconstructed event never counted", async () => {
    const client = await signIn("m6-7-sr-bde1@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await getStageRegressionReport(client, session.actor);
    expect(result.scope).toBe("own");
    expect(result.activeDealCount).toBe(3);
    expect(result.regressedCount).toBe(1); // not 2 - the reconstructed regression never counts
    expect(result.rate).toEqual({ status: "ok", value: 1 / 3, sampleSize: 3 });
    expect(result.regressedDeals).toHaveLength(1);
    const [regressed] = result.regressedDeals;
    expect(regressed).toMatchObject({
      dealId: ids.regressedDealId,
      reference: "D-6-7-SR-REGRESSED",
      name: "D-6-7-SR-REGRESSED",
      currentStageName: "Proposal",
      fromStageName: "Negotiation",
      toStageName: "Proposal",
    });
    expect(new Date(regressed!.occurredAt).toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });

  it("a bde with zero deals reads insufficient_data, never denied (analytics.view_own)", async () => {
    const client = await signIn("m6-7-sr-bde3@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await getStageRegressionReport(client, session.actor);
    expect(result.scope).toBe("own");
    expect(result.activeDealCount).toBe(0);
    expect(result.rate).toEqual({ status: "insufficient_data", sampleSize: 0, minimumRequired: 1 });
    expect(result.regressedDeals).toEqual([]);
  });

  it("a team_lead (team scope) sees bde1's regression but not bde2's, even though both are in the same practice (D-18/D-20)", async () => {
    const client = await signIn("m6-7-sr-team-lead@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await getStageRegressionReport(client, session.actor);
    expect(result.scope).toBe("team");
    expect(result.activeDealCount).toBe(3);
    expect(result.regressedCount).toBe(1);
    expect(result.regressedDeals.map((d) => d.dealId)).toEqual([ids.regressedDealId]);
  });

  it("a director (practice scope) sees bde1's and bde2's regressions, but not the other practice's", async () => {
    const client = await signIn("m6-7-sr-director@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await getStageRegressionReport(client, session.actor);
    expect(result.scope).toBe("practice");
    expect(result.activeDealCount).toBe(4);
    expect(result.regressedCount).toBe(2);
    // most-recently-regressed first
    expect(result.regressedDeals.map((d) => d.dealId)).toEqual([ids.bde2DealId, ids.regressedDealId]);
  });

  it("an executive (tenant scope) sees every practice's regressions", async () => {
    const client = await signIn("m6-7-sr-exec@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await getStageRegressionReport(client, session.actor);
    expect(result.scope).toBe("tenant");
    expect(result.activeDealCount).toBe(5);
    expect(result.regressedCount).toBe(3);
    expect(result.regressedDeals.map((d) => d.dealId)).toEqual([ids.otherDealId, ids.bde2DealId, ids.regressedDealId]);
  });
});
