import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSessionActor } from "@/services/actor";
import { changeStage, getDealDetail, listPipelineDeals } from "@/services/deals";
import { findOrCreateTenant, findOrCreateUser, signIn as signInAs } from "./support/permanentFixture";

// M1.4/M1.5 exit criteria (docs/07-build-backlog.md): "Pipeline table view with the advanced
// filter set" and "Pipeline board view with drag, routed through the single changeStage service
// path." This proves both src/data/deals.ts's listDeals (via listPipelineDeals) and changeStage
// against the real hosted project: the money-precision-safe join (pipeline_stages/accounts/
// practice_lines/owner), every filter actually narrows results, and - the part a service-role-only
// test cannot prove - that migration 0005's deals_select/deals_update RLS policies really do scope
// a signed-in bde to their own practice line while an executive can act tenant-wide.
//
// changeStage calls writeAudit on every successful move, same as createDeal (M1.3) - so once the
// stage-change tests run, this tenant's users become permanently un-deletable (see
// tests/integration/support/permanentFixture.ts). This fixture is find-or-create/permanent for
// tenant + users accordingly, and delete-and-recreate for everything underneath that has no
// audit_entries FK pointing at it.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M1-4-Integration-Test-Pw1!";

let service: SupabaseClient;

const ids = {
  tenantId: "",
  advisoryPracticeLineId: "",
  searchPracticeLineId: "",
  discoveryStageId: "",
  proposalStageId: "",
  wonStageId: "",
  lostStageId: "",
  advisoryAccountId: "",
  searchAccountId: "",
  bdeAdvisoryAuthId: "",
  bdeAdvisory2AuthId: "",
  bdeAdvisory3AuthId: "",
  bdeSearchAuthId: "",
  executiveAuthId: "",
  advisoryDealId: "",
  searchDealId: "",
};

async function cleanup() {
  if (!ids.tenantId) return;
  await service.from("deal_co_owners").delete().eq("deal_id", ids.advisoryDealId);
  await service.from("deals").delete().eq("tenant_id", ids.tenantId);
  await service.from("account_practice_owners").delete().in("account_id", [ids.advisoryAccountId, ids.searchAccountId]);
  await service.from("accounts").delete().eq("tenant_id", ids.tenantId);
  await service.from("pipeline_stages").delete().eq("tenant_id", ids.tenantId);
  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  await service.from("practice_lines").delete().eq("tenant_id", ids.tenantId);
  // Deliberately not deleting users, tenants, or the auth users: once changeStage's "successful
  // move" test writes an audit_entries row, they are permanently un-deletable - see
  // tests/integration/support/permanentFixture.ts. Attempting it here would just be a silent
  // no-op every time.
}

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

beforeAll(async () => {
  service = createServiceClient();

  ids.tenantId = await findOrCreateTenant(service, "m1-4-integration-test", "M1.4 Integration Test Tenant");

  const { data: practiceLines, error: practiceLinesError } = await service
    .from("practice_lines")
    .insert([
      { tenant_id: ids.tenantId, name: "Advisory", code: "ADV" },
      { tenant_id: ids.tenantId, name: "Search", code: "SRCH" },
    ])
    .select("id, code");
  if (practiceLinesError) throw new Error(`seed practice lines failed: ${practiceLinesError.message}`);
  ids.advisoryPracticeLineId = practiceLines!.find((p) => p.code === "ADV")!.id;
  ids.searchPracticeLineId = practiceLines!.find((p) => p.code === "SRCH")!.id;

  const { data: stages, error: stagesError } = await service
    .from("pipeline_stages")
    .insert([
      { tenant_id: ids.tenantId, name: "Discovery", code: "DISCOVERY", sort_order: 1, probability_threshold: 20, stage_type: "open" },
      { tenant_id: ids.tenantId, name: "Proposal", code: "PROPOSAL", sort_order: 2, probability_threshold: 50, stage_type: "open" },
      { tenant_id: ids.tenantId, name: "Closed Won", code: "WON", sort_order: 3, probability_threshold: 100, stage_type: "won" },
      { tenant_id: ids.tenantId, name: "Closed Lost", code: "LOST", sort_order: 4, probability_threshold: 0, stage_type: "lost" },
    ])
    .select("id, code");
  if (stagesError) throw new Error(`seed stages failed: ${stagesError.message}`);
  ids.discoveryStageId = stages!.find((s) => s.code === "DISCOVERY")!.id;
  ids.proposalStageId = stages!.find((s) => s.code === "PROPOSAL")!.id;
  ids.wonStageId = stages!.find((s) => s.code === "WON")!.id;
  ids.lostStageId = stages!.find((s) => s.code === "LOST")!.id;

  const { data: accounts, error: accountsError } = await service
    .from("accounts")
    .insert([
      { tenant_id: ids.tenantId, name: "Advisory Client", industry: "Financial Services", region: "West Africa" },
      { tenant_id: ids.tenantId, name: "Search Client" },
    ])
    .select("id, name");
  if (accountsError) throw new Error(`seed accounts failed: ${accountsError.message}`);
  ids.advisoryAccountId = accounts!.find((a) => a.name === "Advisory Client")!.id;
  ids.searchAccountId = accounts!.find((a) => a.name === "Search Client")!.id;

  ids.bdeAdvisoryAuthId = await findOrCreateUser(service, ids.tenantId, "m1-4-bde-advisory@example.com", "Bde Advisory", PASSWORD);
  ids.bdeAdvisory2AuthId = await findOrCreateUser(service, ids.tenantId, "m1-4-bde-advisory-2@example.com", "Bde Advisory Two", PASSWORD);
  ids.bdeAdvisory3AuthId = await findOrCreateUser(service, ids.tenantId, "m1-4-bde-advisory-3@example.com", "Bde Advisory Three", PASSWORD);
  ids.bdeSearchAuthId = await findOrCreateUser(service, ids.tenantId, "m1-4-bde-search@example.com", "Bde Search", PASSWORD);
  ids.executiveAuthId = await findOrCreateUser(service, ids.tenantId, "m1-4-executive@example.com", "Test Executive", PASSWORD);

  await service.from("user_roles").insert([
    { tenant_id: ids.tenantId, user_id: ids.bdeAdvisoryAuthId, role: "bde", practice_line_id: ids.advisoryPracticeLineId },
    { tenant_id: ids.tenantId, user_id: ids.bdeAdvisory2AuthId, role: "bde", practice_line_id: ids.advisoryPracticeLineId },
    { tenant_id: ids.tenantId, user_id: ids.bdeAdvisory3AuthId, role: "bde", practice_line_id: ids.advisoryPracticeLineId },
    { tenant_id: ids.tenantId, user_id: ids.bdeSearchAuthId, role: "bde", practice_line_id: ids.searchPracticeLineId },
    { tenant_id: ids.tenantId, user_id: ids.executiveAuthId, role: "executive", practice_line_id: null },
  ]);

  await service.from("account_practice_owners").insert([
    { account_id: ids.advisoryAccountId, practice_line_id: ids.advisoryPracticeLineId, owner_id: ids.bdeAdvisoryAuthId },
    { account_id: ids.searchAccountId, practice_line_id: ids.searchPracticeLineId, owner_id: ids.bdeSearchAuthId },
  ]);

  const { data: advisoryDeal, error: advisoryDealError } = await service
    .from("deals")
    .insert({
      tenant_id: ids.tenantId,
      reference: "D-4001",
      name: "Advisory Pipeline Deal",
      account_id: ids.advisoryAccountId,
      practice_line_id: ids.advisoryPracticeLineId,
      stage_id: ids.discoveryStageId,
      client_type: "new",
      owner_id: ids.bdeAdvisoryAuthId,
      author_id: ids.bdeAdvisoryAuthId,
      status: "active",
      expected_close_date: "2027-03-01",
      proposal_value_minor: "100000000", // NGN 1,000,000.00
      currency_code: "NGN",
    })
    .select("id")
    .single();
  if (advisoryDealError) throw new Error(`seed advisory deal failed: ${advisoryDealError.message}`);
  ids.advisoryDealId = advisoryDeal.id;

  const { data: searchDeal, error: searchDealError } = await service
    .from("deals")
    .insert({
      tenant_id: ids.tenantId,
      reference: "D-4002",
      name: "Search Won Deal",
      account_id: ids.searchAccountId,
      practice_line_id: ids.searchPracticeLineId,
      stage_id: ids.wonStageId,
      client_type: "existing",
      owner_id: ids.bdeSearchAuthId,
      author_id: ids.bdeSearchAuthId,
      status: "won",
      forecast_category: "closed",
      expected_close_date: "2026-01-01",
      negotiated_value_minor: "50000000", // NGN 500,000.00
      currency_code: "NGN",
    })
    .select("id")
    .single();
  if (searchDealError) throw new Error(`seed search deal failed: ${searchDealError.message}`);
  ids.searchDealId = searchDeal.id;

  await service.from("deal_co_owners").insert({ deal_id: ids.advisoryDealId, user_id: ids.bdeAdvisory3AuthId });
});

afterAll(cleanup);

describe("listPipelineDeals, RLS scoping", () => {
  it("a bde sees only their own practice line's deal, correctly joined and money-exact", async () => {
    const client = await signIn("m1-4-bde-advisory@example.com");
    const deals = await listPipelineDeals(client, {});

    expect(deals).toHaveLength(1);
    const [deal] = deals;
    expect(deal!.id).toBe(ids.advisoryDealId);
    expect(deal!.accountName).toBe("Advisory Client");
    expect(deal!.practiceLineName).toBe("Advisory");
    expect(deal!.stage.name).toBe("Discovery");
    expect(deal!.ownerName).toBe("Bde Advisory");
    expect(deal!.value).toEqual({ amountMinor: 100_000_000n, currency: "NGN" });
    // resolveProbability: no override, so the stage's own 20% threshold applies.
    expect(deal!.weightedValue).toEqual({ amountMinor: 20_000_000n, currency: "NGN" });
  });

  it("a bde in a different practice line sees the other deal instead, never both", async () => {
    const client = await signIn("m1-4-bde-search@example.com");
    const deals = await listPipelineDeals(client, {});

    expect(deals).toHaveLength(1);
    expect(deals[0]!.id).toBe(ids.searchDealId);
    expect(deals[0]!.status).toBe("won");
    expect(deals[0]!.weightedValue).toEqual({ amountMinor: 50_000_000n, currency: "NGN" });
  });

  it("an executive sees every deal in the tenant, across both practice lines", async () => {
    const client = await signIn("m1-4-executive@example.com");
    const deals = await listPipelineDeals(client, {});

    expect(deals.map((d) => d.id).sort()).toEqual([ids.advisoryDealId, ids.searchDealId].sort());
  });
});

describe("listPipelineDeals, filters", () => {
  it("filters by status", async () => {
    const client = await signIn("m1-4-executive@example.com");
    const deals = await listPipelineDeals(client, { status: "won" });
    expect(deals).toHaveLength(1);
    expect(deals[0]!.id).toBe(ids.searchDealId);
  });

  it("filters by client type", async () => {
    const client = await signIn("m1-4-executive@example.com");
    const deals = await listPipelineDeals(client, { clientType: "new" });
    expect(deals).toHaveLength(1);
    expect(deals[0]!.id).toBe(ids.advisoryDealId);
  });

  it("filters by practice line", async () => {
    const client = await signIn("m1-4-executive@example.com");
    const deals = await listPipelineDeals(client, { practiceLineId: ids.searchPracticeLineId });
    expect(deals).toHaveLength(1);
    expect(deals[0]!.id).toBe(ids.searchDealId);
  });

  it("filters by stage", async () => {
    const client = await signIn("m1-4-executive@example.com");
    const deals = await listPipelineDeals(client, { stageId: ids.lostStageId });
    expect(deals).toHaveLength(0);
  });

  it("a filter that narrows to nothing for this bde's practice returns empty, not the other practice's deal", async () => {
    const client = await signIn("m1-4-bde-advisory@example.com");
    const deals = await listPipelineDeals(client, { clientType: "existing" });
    expect(deals).toHaveLength(0);
  });
});

// M1.6 exit criteria (docs/07-build-backlog.md): "Deal detail read-only skeleton: header, financial
// summary, details, account." Deliberately runs before the changeStage describe block below, which
// mutates advisoryDealId's stage - these assertions are against its original Discovery-stage state.
describe("getDealDetail", () => {
  it("returns the full header/financial/details/account shape for a practice-entitled bde", async () => {
    const client = await signIn("m1-4-bde-advisory@example.com");
    const deal = await getDealDetail(client, ids.advisoryDealId);

    expect(deal).not.toBeNull();
    expect(deal).toMatchObject({
      id: ids.advisoryDealId,
      reference: "D-4001",
      name: "Advisory Pipeline Deal",
      status: "active",
      clientType: "new",
      forecastCategory: "pipeline",
      expectedCloseDate: "2027-03-01",
      actualCloseDate: null,
      probability: 20, // no override, so the Discovery stage's own threshold applies
      value: { amountMinor: 100_000_000n, currency: "NGN" },
      weightedValue: { amountMinor: 20_000_000n, currency: "NGN" },
      proposalValue: { amountMinor: 100_000_000n, currency: "NGN" },
      negotiatedValue: null,
      stage: { id: ids.discoveryStageId, name: "Discovery", stageType: "open" },
      account: { id: ids.advisoryAccountId, name: "Advisory Client", industry: "Financial Services", region: "West Africa" },
      practiceLineName: "Advisory",
      ownerName: "Bde Advisory",
      authorName: "Bde Advisory",
      coOwnerNames: ["Bde Advisory Three"],
    });
  });

  it("an executive (tenant-wide view) can also read it", async () => {
    const client = await signIn("m1-4-executive@example.com");
    const deal = await getDealDetail(client, ids.advisoryDealId);
    expect(deal?.id).toBe(ids.advisoryDealId);
  });

  it("a bde outside the deal's practice gets null - RLS excludes the row entirely, same as changeStage's not_found case", async () => {
    const client = await signIn("m1-4-bde-search@example.com");
    const deal = await getDealDetail(client, ids.advisoryDealId);
    expect(deal).toBeNull();
  });

  it("a nonexistent deal id returns null, not an error", async () => {
    const client = await signIn("m1-4-executive@example.com");
    const deal = await getDealDetail(client, "00000000-0000-0000-0000-000000000000");
    expect(deal).toBeNull();
  });
});

// Deliberately ordered last and reusing advisoryDealId (rather than a dedicated deal): every
// earlier test above asserts something about advisoryDealId's stage or the tenant's total deal
// count, so the one genuinely mutating test in this block - the successful move - runs only after
// all of those have already passed. The three rejection cases don't mutate anything, so their
// order relative to each other doesn't matter.
describe("changeStage", () => {
  it("refuses to move a deal into a won/lost stage - that's closeDeal's job (M5.2), not built yet", async () => {
    const client = await signIn("m1-4-bde-advisory@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await changeStage(client, session.actor, ids.advisoryDealId, ids.wonStageId);
    expect(result).toEqual({ ok: false, code: "target_is_closing_stage" });

    const { data: dealRow } = await service.from("deals").select("stage_id").eq("id", ids.advisoryDealId).single();
    expect(dealRow?.stage_id).toBe(ids.discoveryStageId);
  });

  it("refuses a no-op move to the deal's current stage", async () => {
    const client = await signIn("m1-4-bde-advisory@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await changeStage(client, session.actor, ids.advisoryDealId, ids.discoveryStageId);
    expect(result).toEqual({ ok: false, code: "same_stage" });
  });

  it("a bde from a different practice line can't even see the deal to move it - not_found, not denied", async () => {
    // A real, worthwhile distinction, not a rounding error: changeStage reads the deal through the
    // CALLER's own RLS-scoped session (getDealForStageChange), and migration 0005's deals_select
    // policy already excludes rows outside the caller's practice entitlement entirely. So this
    // request never reaches can() at all - it fails at the read, before authorisation logic runs -
    // and correctly reports not_found rather than denied, the same not-confirming-existence-to-an-
    // unauthorised-caller pattern a 404-instead-of-403 API response uses. The next test below
    // proves the different case: a same-practice bde who CAN see the deal (deal.view is
    // practice-scoped) but isn't its owner/co-owner/author gets a real "denied" from can().
    const client = await signIn("m1-4-bde-search@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await changeStage(client, session.actor, ids.advisoryDealId, ids.proposalStageId);
    expect(result).toEqual({ ok: false, code: "not_found" });

    const { data: dealRow } = await service.from("deals").select("stage_id").eq("id", ids.advisoryDealId).single();
    expect(dealRow?.stage_id).toBe(ids.discoveryStageId);
  });

  it("a same-practice bde who can see the deal but doesn't own/co-own/author it is really denied", async () => {
    const client = await signIn("m1-4-bde-advisory-2@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    // Confirms this bde genuinely can see the deal (deal.view is practice-scoped) - ruling out the
    // not_found case above before asserting the denial is a real can() denial, not a masked read
    // failure of a different kind.
    const visible = await listPipelineDeals(client, {});
    expect(visible.some((d) => d.id === ids.advisoryDealId)).toBe(true);

    const result = await changeStage(client, session.actor, ids.advisoryDealId, ids.proposalStageId);
    expect(result).toEqual({ ok: false, code: "denied" });

    const { data: dealRow } = await service.from("deals").select("stage_id").eq("id", ids.advisoryDealId).single();
    expect(dealRow?.stage_id).toBe(ids.discoveryStageId);
  });

  it("the owning bde moves their deal to another open stage; exactly one audit row is written", async () => {
    const client = await signIn("m1-4-bde-advisory@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await changeStage(client, session.actor, ids.advisoryDealId, ids.proposalStageId);
    expect(result).toEqual({ ok: true });

    // Not asserting updated_at/updated_by here: migration 0006 (the trigger that maintains them)
    // is verified locally in tests/rls/deals_foundation.spec.ts, against a real per-user Postgres
    // session, but this container has no raw-TCP egress to the hosted project's database and no
    // valid Supabase Management API token in this session to run DDL through instead - so 0006
    // has not yet been mirrored onto the real project the way migration 0005 was. Flagged as an
    // outstanding manual step (see README.md's M1.5 entry), not silently assumed done.
    const { data: dealRow } = await service.from("deals").select("stage_id").eq("id", ids.advisoryDealId).single();
    expect(dealRow?.stage_id).toBe(ids.proposalStageId);

    const { data: auditRows } = await service
      .from("audit_entries")
      .select("action, actor_id, before, after")
      .eq("entity_id", ids.advisoryDealId)
      .eq("action", "deal.change_stage");
    expect(auditRows).toHaveLength(1);
    expect(auditRows?.[0]).toMatchObject({
      action: "deal.change_stage",
      actor_id: ids.bdeAdvisoryAuthId,
      before: { stageId: ids.discoveryStageId },
      after: { stageId: ids.proposalStageId },
    });
  });
});
