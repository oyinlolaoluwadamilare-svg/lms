import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSessionActor } from "@/services/actor";
import { getPipelineMetrics } from "@/services/reports";
import { findOrCreateByUniqueMatch, findOrCreateTenant, findOrCreateUser, signIn as signInAs } from "./support/permanentFixture";

// M6.1 exit criteria (docs/07-build-backlog.md): "Metric layer implementing 04-metric-definitions.md
// exactly" - proves docs/04-metric-definitions.md's "Pipeline metrics" section (Open pipeline value,
// Weighted forecast, Category forecast) end to end, against the real hosted project through real
// signed-in sessions, and proves getPipelineMetrics's own "widest scope this actor is entitled to"
// derivation: own (owner/author/co-owner) for a bde with no higher grant, practice for a team_lead,
// tenant for an executive - the same role-grant derivation getLossReasonReport already established,
// except a bde is never denied here (analytics.view_own is "yes" for every role).
//
// Deals are inserted directly via the service client, never through createDeal - no stage_events
// row is ever written for them, so (like loss-reason-report.spec.ts's own fixture) they carry none
// of that table's forbid_mutation-triggered permanence and can be safely delete-and-recreated.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M6-1-Integration-Test-Pw1!";

let service: SupabaseClient;

const ids = {
  tenantId: "",
  practiceAId: "",
  practiceBId: "",
  stageId: "",
  accountId: "",
  bdeAuthId: "",
  coOwnerBdeAuthId: "",
  otherPracticeBdeAuthId: "",
  teamLeadAuthId: "",
  executiveAuthId: "",
};

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

async function deleteTenantDeals(): Promise<void> {
  const { data: existingDeals } = await service.from("deals").select("id").eq("tenant_id", ids.tenantId);
  const dealIds = (existingDeals ?? []).map((d) => d.id);
  if (dealIds.length > 0) {
    await service.from("deal_co_owners").delete().in("deal_id", dealIds);
  }
  await service.from("deals").delete().eq("tenant_id", ids.tenantId);
}

async function insertActiveDeal(
  reference: string,
  practiceLineId: string,
  ownerId: string,
  authorId: string,
  negotiatedValueMinor: string,
  forecastCategory: "pipeline" | "best_case" | "commit" | "closed",
  extra: { status?: "active" | "won"; isDemo?: boolean } = {},
): Promise<string> {
  const { data, error } = await service
    .from("deals")
    .insert({
      tenant_id: ids.tenantId,
      reference,
      name: reference,
      account_id: ids.accountId,
      practice_line_id: practiceLineId,
      stage_id: ids.stageId,
      client_type: "new",
      owner_id: ownerId,
      author_id: authorId,
      status: extra.status ?? "active",
      negotiated_value_minor: negotiatedValueMinor,
      currency_code: "NGN",
      forecast_category: forecastCategory,
      expected_close_date: "2027-06-01",
      is_demo: extra.isDemo ?? false,
    })
    .select("id")
    .single();
  if (error) throw new Error(`seed deal ${reference} failed: ${error.message}`);
  return data.id;
}

beforeAll(async () => {
  service = createServiceClient();

  ids.tenantId = await findOrCreateTenant(service, "m6-1-integration-test", "M6.1 Integration Test Tenant");
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
  // probability_threshold: 50 - a round number so weighted-forecast expectations in this file are
  // exactly half of open pipeline value, not a fractional pain to hand-compute.
  ids.stageId = await findOrCreateByUniqueMatch(
    service,
    "pipeline_stages",
    { tenant_id: ids.tenantId, code: "DISCOVERY" },
    { tenant_id: ids.tenantId, name: "Discovery", code: "DISCOVERY", sort_order: 1, probability_threshold: 50, stage_type: "open" },
  );
  ids.accountId = await findOrCreateByUniqueMatch(
    service,
    "accounts",
    { tenant_id: ids.tenantId, name: "M6.1 Test Client" },
    { tenant_id: ids.tenantId, name: "M6.1 Test Client" },
  );

  ids.bdeAuthId = await findOrCreateUser(service, ids.tenantId, "m6-1-bde@example.com", "M6.1 Bde", PASSWORD);
  ids.coOwnerBdeAuthId = await findOrCreateUser(service, ids.tenantId, "m6-1-co-owner-bde@example.com", "M6.1 Co-owner Bde", PASSWORD);
  ids.otherPracticeBdeAuthId = await findOrCreateUser(service, ids.tenantId, "m6-1-other-practice-bde@example.com", "M6.1 Other Practice Bde", PASSWORD);
  ids.teamLeadAuthId = await findOrCreateUser(service, ids.tenantId, "m6-1-team-lead@example.com", "M6.1 Team Lead", PASSWORD);
  ids.executiveAuthId = await findOrCreateUser(service, ids.tenantId, "m6-1-executive@example.com", "M6.1 Executive", PASSWORD);

  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  const { error: roleError } = await service.from("user_roles").insert([
    { tenant_id: ids.tenantId, user_id: ids.bdeAuthId, role: "bde", practice_line_id: ids.practiceAId },
    { tenant_id: ids.tenantId, user_id: ids.coOwnerBdeAuthId, role: "bde", practice_line_id: ids.practiceAId },
    { tenant_id: ids.tenantId, user_id: ids.otherPracticeBdeAuthId, role: "bde", practice_line_id: ids.practiceBId },
    { tenant_id: ids.tenantId, user_id: ids.teamLeadAuthId, role: "team_lead", practice_line_id: ids.practiceAId },
    { tenant_id: ids.tenantId, user_id: ids.executiveAuthId, role: "executive", practice_line_id: null },
  ]);
  if (roleError) throw new Error(`fixture role grant failed: ${roleError.message}`);

  await deleteTenantDeals();

  // Advisory practice - the set analytics.view_own's bde and analytics.view_practice's team_lead
  // both need to reason about:
  await insertActiveDeal("D-6-1-A1", ids.practiceAId, ids.bdeAuthId, ids.bdeAuthId, "1000000", "pipeline");
  await insertActiveDeal(
    "D-6-1-A2",
    ids.practiceAId,
    ids.coOwnerBdeAuthId,
    ids.bdeAuthId, // bde is the author, not the owner - "own" scope must still include it
    "2000000",
    "commit",
  );
  const dealCoOwnedByBdeId = await insertActiveDeal(
    "D-6-1-A3",
    ids.practiceAId,
    ids.coOwnerBdeAuthId,
    ids.coOwnerBdeAuthId,
    "3000000",
    "best_case",
  );
  await service.from("deal_co_owners").insert({ deal_id: dealCoOwnedByBdeId, user_id: ids.bdeAuthId, added_by: ids.coOwnerBdeAuthId });

  // Owned and authored entirely by someone else, with bde having no relation at all - visible to
  // bde via practice-wide RLS (D-02), but must NOT appear in bde's own analytics scope.
  await insertActiveDeal("D-6-1-A4", ids.practiceAId, ids.coOwnerBdeAuthId, ids.coOwnerBdeAuthId, "4000000", "pipeline");

  // Excluded everywhere: demo row and a won (non-active) deal.
  await insertActiveDeal("D-6-1-A5-DEMO", ids.practiceAId, ids.bdeAuthId, ids.bdeAuthId, "5000000", "pipeline", { isDemo: true });
  await insertActiveDeal("D-6-1-A6-WON", ids.practiceAId, ids.bdeAuthId, ids.bdeAuthId, "6000000", "closed", { status: "won" });

  // Executive Search practice - out of the Advisory team_lead's own scope, but tenant-wide for the
  // executive.
  await insertActiveDeal("D-6-1-B1", ids.practiceBId, ids.otherPracticeBdeAuthId, ids.otherPracticeBdeAuthId, "7000000", "pipeline");
});

afterAll(async () => {
  await deleteTenantDeals();
  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
});

describe("getPipelineMetrics, end to end against a real signed-in session", () => {
  it("a bde with no higher grant gets 'own' scope: owner, author or co-owner only, never a deal they merely have practice-wide read access to", async () => {
    const client = await signIn("m6-1-bde@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const metrics = await getPipelineMetrics(client, session.actor);

    expect(metrics.scope).toBe("own");
    expect(metrics.dealCount).toBe(3); // owned + authored + co-owned, not the fourth Advisory deal
    expect(metrics.openPipelineValue).toEqual([{ amountMinor: 6_000_000n, currency: "NGN" }]);
    expect(metrics.weightedForecast).toEqual([{ amountMinor: 3_000_000n, currency: "NGN" }]); // 50% of 6,000,000

    const pipeline = metrics.categoryForecast.find((c) => c.category === "pipeline");
    const commit = metrics.categoryForecast.find((c) => c.category === "commit");
    const bestCase = metrics.categoryForecast.find((c) => c.category === "best_case");
    const closed = metrics.categoryForecast.find((c) => c.category === "closed");
    expect(pipeline?.value).toEqual([{ amountMinor: 1_000_000n, currency: "NGN" }]);
    expect(commit?.value).toEqual([{ amountMinor: 2_000_000n, currency: "NGN" }]);
    expect(bestCase?.value).toEqual([{ amountMinor: 3_000_000n, currency: "NGN" }]);
    expect(closed?.value).toEqual([]); // always listed, even with nothing in it
    expect(metrics.categoryForecast).toHaveLength(4);
  });

  it("a team_lead gets 'practice' scope: every active, non-demo Advisory deal regardless of owner, excluding Executive Search entirely", async () => {
    const client = await signIn("m6-1-team-lead@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const metrics = await getPipelineMetrics(client, session.actor);

    expect(metrics.scope).toBe("practice");
    expect(metrics.dealCount).toBe(4); // all four Advisory deals, including the one bde has no relation to
    expect(metrics.openPipelineValue).toEqual([{ amountMinor: 10_000_000n, currency: "NGN" }]);
    expect(metrics.weightedForecast).toEqual([{ amountMinor: 5_000_000n, currency: "NGN" }]);

    const pipeline = metrics.categoryForecast.find((c) => c.category === "pipeline");
    expect(pipeline?.value).toEqual([{ amountMinor: 5_000_000n, currency: "NGN" }]); // 1,000,000 + 4,000,000
  });

  it("an executive gets 'tenant' scope: both practices summed together", async () => {
    const client = await signIn("m6-1-executive@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const metrics = await getPipelineMetrics(client, session.actor);

    expect(metrics.scope).toBe("tenant");
    expect(metrics.dealCount).toBe(5); // four Advisory + one Executive Search
    expect(metrics.openPipelineValue).toEqual([{ amountMinor: 17_000_000n, currency: "NGN" }]);
    expect(metrics.weightedForecast).toEqual([{ amountMinor: 8_500_000n, currency: "NGN" }]);
  });

  it("demo rows and non-active (won) deals never contribute to any scope's totals", async () => {
    const client = await signIn("m6-1-executive@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const metrics = await getPipelineMetrics(client, session.actor);

    // 17,000,000 excludes the 5,000,000 demo row and the 6,000,000 won deal - if either leaked in,
    // this total would be 22,000,000 or 23,000,000 or 28,000,000 instead.
    expect(metrics.openPipelineValue).toEqual([{ amountMinor: 17_000_000n, currency: "NGN" }]);
  });
});
