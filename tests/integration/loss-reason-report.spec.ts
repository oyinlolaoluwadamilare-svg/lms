import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSessionActor } from "@/services/actor";
import { getLossReasonReport } from "@/services/reports";
import { findOrCreateByUniqueMatch, findOrCreateTenant, findOrCreateUser, signIn as signInAs } from "./support/permanentFixture";

// M5.4 exit criteria (docs/07-build-backlog.md): "Loss-reason report by practice, value band and
// competitor." Proves, against the real hosted project through real signed-in sessions:
// getLossReasonReport's own scope derivation (Team Lead sees only their own practice, Executive
// sees tenant-wide, a Bde is denied entirely - docs/02-permission-matrix.md's analytics.view_practice
// row, unchanged by this milestone) and the breakdown counts themselves, across three seeded lost
// deals spanning two practices, three value bands (including "not recorded") and both a
// competitor-attributed and a plain loss.
//
// Unlike close-deal.spec.ts's own fixture, these deals are inserted directly as already-lost via
// the service client, never through closeDeal - no stage_events row is ever written for them, so
// (unlike every deal that has actually been closed through the real service) they carry none of
// that table's forbid_mutation-triggered permanence and can be safely delete-and-recreated in
// afterAll like any other mutable fixture row.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M5-4-Integration-Test-Pw1!";

let service: SupabaseClient;

const ids = {
  tenantId: "",
  practiceAId: "",
  practiceBId: "",
  accountId: "",
  stageId: "",
  teamLeadAAuthId: "",
  executiveAuthId: "",
  bdeAuthId: "",
  budgetReasonId: "",
  competitorReasonId: "",
};

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

// deal_outcomes.deal_id references deals(id) with no ON DELETE CASCADE (migration 0016 - deal_id
// is deal_outcomes' own primary key, one outcome per deal, ever) - deleting a deal that still has
// an outcome row fails on the FK, so every deals delete in this fixture goes through here first.
async function deleteTenantDealsAndOutcomes(): Promise<void> {
  const { data: existingDeals } = await service.from("deals").select("id").eq("tenant_id", ids.tenantId);
  const dealIds = (existingDeals ?? []).map((d) => d.id);
  if (dealIds.length > 0) {
    await service.from("deal_outcomes").delete().in("deal_id", dealIds);
  }
  await service.from("deals").delete().eq("tenant_id", ids.tenantId);
}

async function insertLostDeal(
  reference: string,
  practiceLineId: string,
  reasonId: string,
  negotiatedValueMinor: string | null,
  competitorName: string | null,
): Promise<string> {
  const { data: deal, error: dealError } = await service
    .from("deals")
    .insert({
      tenant_id: ids.tenantId,
      reference,
      name: reference,
      account_id: ids.accountId,
      practice_line_id: practiceLineId,
      stage_id: ids.stageId,
      client_type: "new",
      author_id: ids.teamLeadAAuthId,
      status: "lost",
      negotiated_value_minor: negotiatedValueMinor,
      currency_code: "NGN",
    })
    .select("id")
    .single();
  if (dealError) throw new Error(`seed lost deal ${reference} failed: ${dealError.message}`);

  const { error: outcomeError } = await service.from("deal_outcomes").insert({
    deal_id: deal.id,
    result: "loss",
    reason_id: reasonId,
    reason_detail: "seeded for M5.4 integration test",
    competitor_name: competitorName,
    actual_close_date: "2026-01-01",
    closed_by: ids.teamLeadAAuthId,
  });
  if (outcomeError) throw new Error(`seed deal_outcomes for ${reference} failed: ${outcomeError.message}`);

  return deal.id;
}

beforeAll(async () => {
  service = createServiceClient();

  ids.tenantId = await findOrCreateTenant(service, "m5-4-integration-test", "M5.4 Integration Test Tenant");
  ids.practiceAId = await findOrCreateByUniqueMatch(
    service,
    "practice_lines",
    { tenant_id: ids.tenantId, code: "ADV" },
    { tenant_id: ids.tenantId, name: "Advisory", code: "ADV" },
  );
  ids.practiceBId = await findOrCreateByUniqueMatch(
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
    { tenant_id: ids.tenantId, name: "M5.4 Test Client" },
    { tenant_id: ids.tenantId, name: "M5.4 Test Client" },
  );

  ids.teamLeadAAuthId = await findOrCreateUser(service, ids.tenantId, "m5-4-team-lead@example.com", "M5.4 Team Lead", PASSWORD);
  ids.executiveAuthId = await findOrCreateUser(service, ids.tenantId, "m5-4-executive@example.com", "M5.4 Executive", PASSWORD);
  ids.bdeAuthId = await findOrCreateUser(service, ids.tenantId, "m5-4-bde@example.com", "M5.4 Bde", PASSWORD);

  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  const { error: roleError } = await service.from("user_roles").insert([
    { tenant_id: ids.tenantId, user_id: ids.teamLeadAAuthId, role: "team_lead", practice_line_id: ids.practiceAId },
    { tenant_id: ids.tenantId, user_id: ids.executiveAuthId, role: "executive", practice_line_id: null },
    { tenant_id: ids.tenantId, user_id: ids.bdeAuthId, role: "bde", practice_line_id: ids.practiceAId },
  ]);
  if (roleError) throw new Error(`fixture role grant failed: ${roleError.message}`);

  ids.budgetReasonId = await findOrCreateByUniqueMatch(
    service,
    "outcome_reasons",
    { tenant_id: ids.tenantId, type: "loss", label: "Budget cut" },
    { tenant_id: ids.tenantId, type: "loss", label: "Budget cut", requires_competitor_name: false },
  );
  ids.competitorReasonId = await findOrCreateByUniqueMatch(
    service,
    "outcome_reasons",
    { tenant_id: ids.tenantId, type: "loss", label: "Lost to competitor" },
    { tenant_id: ids.tenantId, type: "loss", label: "Lost to competitor", requires_competitor_name: true },
  );

  await deleteTenantDealsAndOutcomes();

  // dealA1: practice A, under_5m band (₦1,000,000 = 100_000_00 kobo), Budget cut, no competitor.
  await insertLostDeal("D-5-4-A1", ids.practiceAId, ids.budgetReasonId, "100000000", null);
  // dealA2: practice A, 5m_25m band (₦10,000,000 = 1_000_000_00 kobo), Lost to competitor, "Acme".
  await insertLostDeal("D-5-4-A2", ids.practiceAId, ids.competitorReasonId, "1000000000", "Acme");
  // dealB1: practice B, value not recorded, Budget cut, no competitor.
  await insertLostDeal("D-5-4-B1", ids.practiceBId, ids.budgetReasonId, null, null);
});

afterAll(async () => {
  await deleteTenantDealsAndOutcomes();
  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
});

describe("getLossReasonReport, end to end against a real signed-in session", () => {
  it("a bde is denied entirely - analytics.view_practice has no scope for that role", async () => {
    const client = await signIn("m5-4-bde@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await getLossReasonReport(client, session.actor);
    expect(result).toEqual({ ok: false, code: "denied" });
  });

  it("a team_lead sees only their own practice's losses", async () => {
    const client = await signIn("m5-4-team-lead@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await getLossReasonReport(client, session.actor);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.report.totalLosses).toBe(2);
    expect(result.report.byPractice).toEqual([{ label: "Advisory", count: 2 }]);
    expect(result.report.byReason).toEqual(
      expect.arrayContaining([
        { label: "Budget cut", count: 1 },
        { label: "Lost to competitor", count: 1 },
      ]),
    );
    expect(result.report.byCompetitor).toEqual(
      expect.arrayContaining([
        { label: "Not specified", count: 1 },
        { label: "Acme", count: 1 },
      ]),
    );
    const underFiveM = result.report.byValueBand.find((b) => b.label === "Under ₦5,000,000");
    const fiveToTwentyFiveM = result.report.byValueBand.find((b) => b.label === "₦5,000,000 – ₦24,999,999");
    const notRecorded = result.report.byValueBand.find((b) => b.label === "Value not recorded");
    expect(underFiveM?.count).toBe(1);
    expect(fiveToTwentyFiveM?.count).toBe(1);
    expect(notRecorded?.count).toBe(0); // practice B's not-recorded loss is out of this actor's scope
  });

  it("an executive sees tenant-wide losses across both practices, including the value-not-recorded one", async () => {
    const client = await signIn("m5-4-executive@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await getLossReasonReport(client, session.actor);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.report.totalLosses).toBe(3);
    expect(result.report.byPractice).toEqual(
      expect.arrayContaining([
        { label: "Advisory", count: 2 },
        { label: "Executive Search", count: 1 },
      ]),
    );
    const notRecorded = result.report.byValueBand.find((b) => b.label === "Value not recorded");
    expect(notRecorded?.count).toBe(1);

    // Every band is always listed, even ones with zero losses (docs/04-metric-definitions.md: no
    // silent gaps in this fixed, small taxonomy).
    expect(result.report.byValueBand).toHaveLength(5);
    const hundredMPlus = result.report.byValueBand.find((b) => b.label === "₦100,000,000 and above");
    expect(hundredMPlus?.count).toBe(0);
  });
});
