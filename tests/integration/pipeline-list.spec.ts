import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { daysBetweenInTimezone } from "@/lib/dates";
import { getSessionActor } from "@/services/actor";
import { changeStage, getDealDetail, listPipelineDeals, updateDeal } from "@/services/deals";
import { getStageHistory } from "@/services/stageEvents";
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
// tests/integration/support/permanentFixture.ts). M2.1 made this worse in one specific way: it also
// writes a stage_events row referencing the deal (a real FK, no cascade), and stage_events is
// itself immutable (forbid_mutation blocks delete for every role, including service_role) - so the
// advisory deal itself, and everything upstream it references (account, practice line, stage),
// becomes permanently un-deletable too, the same way audit_entries already pins the tenant/users.
// Verified directly, not assumed: a delete-and-recreate attempt here silently no-ops (Postgres
// rejects the whole multi-row DELETE statement on the one FK-violating row, and supabase-js's
// delete() resolves with an unchecked {error} rather than throwing) and leaves duplicate rows
// accumulating in the real project on every subsequent run. This fixture is find-or-create for the
// tenant, users, practice lines, stages, accounts and both deals accordingly - the advisory deal's
// mutable fields (stage_id, name, brief, ...) are additionally reset to their original seed values
// on every run, since several tests below depend on a specific known starting state, not merely on
// the row existing.

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
  await service.from("account_practice_owners").delete().in("account_id", [ids.advisoryAccountId, ids.searchAccountId]);
  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  // Deliberately not deleting deals, accounts, pipeline_stages, practice_lines, users, tenants, or
  // the auth users - see this file's header comment for why deals specifically joined
  // tenants/users on the permanently-un-deletable list once M2.1 shipped. beforeAll is
  // find-or-create (plus an explicit reset for the advisory deal's mutable fields) for all of
  // these instead of delete-and-recreate.
}

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

async function findOrCreateByUniqueMatch(
  table: string,
  match: Record<string, string>,
  insertRow: Record<string, unknown>,
): Promise<string> {
  const { data: existing, error: findError } = await service.from(table).select("id").match(match).maybeSingle();
  if (findError) throw new Error(`look up ${table} (${JSON.stringify(match)}) failed: ${findError.message}`);
  if (existing) return existing.id;

  const { data, error } = await service.from(table).insert(insertRow).select("id").single();
  if (error) throw new Error(`seed ${table} (${JSON.stringify(match)}) failed: ${error.message}`);
  return data.id;
}

beforeAll(async () => {
  service = createServiceClient();

  ids.tenantId = await findOrCreateTenant(service, "m1-4-integration-test", "M1.4 Integration Test Tenant");

  ids.advisoryPracticeLineId = await findOrCreateByUniqueMatch(
    "practice_lines",
    { tenant_id: ids.tenantId, code: "ADV" },
    { tenant_id: ids.tenantId, name: "Advisory", code: "ADV" },
  );
  ids.searchPracticeLineId = await findOrCreateByUniqueMatch(
    "practice_lines",
    { tenant_id: ids.tenantId, code: "SRCH" },
    { tenant_id: ids.tenantId, name: "Search", code: "SRCH" },
  );

  ids.discoveryStageId = await findOrCreateByUniqueMatch(
    "pipeline_stages",
    { tenant_id: ids.tenantId, code: "DISCOVERY" },
    { tenant_id: ids.tenantId, name: "Discovery", code: "DISCOVERY", sort_order: 1, probability_threshold: 20, stage_type: "open" },
  );
  ids.proposalStageId = await findOrCreateByUniqueMatch(
    "pipeline_stages",
    { tenant_id: ids.tenantId, code: "PROPOSAL" },
    { tenant_id: ids.tenantId, name: "Proposal", code: "PROPOSAL", sort_order: 2, probability_threshold: 50, stage_type: "open" },
  );
  ids.wonStageId = await findOrCreateByUniqueMatch(
    "pipeline_stages",
    { tenant_id: ids.tenantId, code: "WON" },
    { tenant_id: ids.tenantId, name: "Closed Won", code: "WON", sort_order: 3, probability_threshold: 100, stage_type: "won" },
  );
  ids.lostStageId = await findOrCreateByUniqueMatch(
    "pipeline_stages",
    { tenant_id: ids.tenantId, code: "LOST" },
    { tenant_id: ids.tenantId, name: "Closed Lost", code: "LOST", sort_order: 4, probability_threshold: 0, stage_type: "lost" },
  );

  ids.advisoryAccountId = await findOrCreateByUniqueMatch(
    "accounts",
    { tenant_id: ids.tenantId, name: "Advisory Client" },
    { tenant_id: ids.tenantId, name: "Advisory Client", industry: "Financial Services", region: "West Africa" },
  );
  ids.searchAccountId = await findOrCreateByUniqueMatch(
    "accounts",
    { tenant_id: ids.tenantId, name: "Search Client" },
    { tenant_id: ids.tenantId, name: "Search Client" },
  );

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

  ids.advisoryDealId = await findOrCreateByUniqueMatch(
    "deals",
    { tenant_id: ids.tenantId, reference: "D-4001" },
    {
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
    },
  );

  // M2.1: once changeStage's "successful move" test has run once against this deal, it can never
  // be deleted again (see this file's header comment) - so re-running this suite reuses the same
  // row rather than creating a fresh one, and must reset every mutable field the tests below assume
  // a specific starting value for back to the original seed: changeStage's own tests assert the
  // deal starts in Discovery, and updateDeal's "co-owner no-op edit produces no audit row" test
  // only holds if name/brief/negotiated_value_minor are back to their pristine values too.
  const { error: resetError } = await service
    .from("deals")
    .update({
      name: "Advisory Pipeline Deal",
      stage_id: ids.discoveryStageId,
      client_type: "new",
      status: "active",
      expected_close_date: "2027-03-01",
      proposal_value_minor: "100000000",
      negotiated_value_minor: null,
      currency_code: "NGN",
      brief: null,
    })
    .eq("id", ids.advisoryDealId);
  if (resetError) throw new Error(`reset advisory deal failed: ${resetError.message}`);

  ids.searchDealId = await findOrCreateByUniqueMatch(
    "deals",
    { tenant_id: ids.tenantId, reference: "D-4002" },
    {
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
    },
  );

  await service.from("deal_co_owners").insert({ deal_id: ids.advisoryDealId, user_id: ids.bdeAdvisory3AuthId });
});

afterAll(cleanup);

describe("listPipelineDeals, RLS scoping", () => {
  it("a bde sees only their own practice line's deal, correctly joined and money-exact", async () => {
    const client = await signIn("m1-4-bde-advisory@example.com");
    const deals = await listPipelineDeals(client, {}, "Africa/Lagos");

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
    const deals = await listPipelineDeals(client, {}, "Africa/Lagos");

    expect(deals).toHaveLength(1);
    expect(deals[0]!.id).toBe(ids.searchDealId);
    expect(deals[0]!.status).toBe("won");
    expect(deals[0]!.weightedValue).toEqual({ amountMinor: 50_000_000n, currency: "NGN" });
  });

  it("an executive sees every deal in the tenant, across both practice lines", async () => {
    const client = await signIn("m1-4-executive@example.com");
    const deals = await listPipelineDeals(client, {}, "Africa/Lagos");

    expect(deals.map((d) => d.id).sort()).toEqual([ids.advisoryDealId, ids.searchDealId].sort());
  });
});

describe("listPipelineDeals, filters", () => {
  it("filters by status", async () => {
    const client = await signIn("m1-4-executive@example.com");
    const deals = await listPipelineDeals(client, { status: "won" }, "Africa/Lagos");
    expect(deals).toHaveLength(1);
    expect(deals[0]!.id).toBe(ids.searchDealId);
  });

  it("filters by client type", async () => {
    const client = await signIn("m1-4-executive@example.com");
    const deals = await listPipelineDeals(client, { clientType: "new" }, "Africa/Lagos");
    expect(deals).toHaveLength(1);
    expect(deals[0]!.id).toBe(ids.advisoryDealId);
  });

  it("filters by practice line", async () => {
    const client = await signIn("m1-4-executive@example.com");
    const deals = await listPipelineDeals(client, { practiceLineId: ids.searchPracticeLineId }, "Africa/Lagos");
    expect(deals).toHaveLength(1);
    expect(deals[0]!.id).toBe(ids.searchDealId);
  });

  it("filters by stage", async () => {
    const client = await signIn("m1-4-executive@example.com");
    const deals = await listPipelineDeals(client, { stageId: ids.lostStageId }, "Africa/Lagos");
    expect(deals).toHaveLength(0);
  });

  it("a filter that narrows to nothing for this bde's practice returns empty, not the other practice's deal", async () => {
    const client = await signIn("m1-4-bde-advisory@example.com");
    const deals = await listPipelineDeals(client, { clientType: "existing" }, "Africa/Lagos");
    expect(deals).toHaveLength(0);
  });
});

// M2.3 (docs/07-build-backlog.md): "Days-in-current-stage derived from the latest event." Scoped
// to that half only - "staleness colour" is deferred to M3.7 per src/data/deals.ts's own comment
// (docs/04-metric-definitions.md ties it strictly to last_engaged_at, an M3 concept that doesn't
// exist yet). Expected values are independently recomputed here (same reasoning as the
// stage_events assertions in the changeStage block below), not hardcoded - this fixture's deals
// carry real accumulated history across every run of this suite, so "days since" is never a fixed
// number.
describe("listPipelineDeals, daysInCurrentStage (M2.3)", () => {
  it("a deal that has never had a stage transition falls back to deals.created_at", async () => {
    const client = await signIn("m1-4-executive@example.com");
    const { data: dealRow } = await service.from("deals").select("created_at").eq("id", ids.searchDealId).single();

    const deals = await listPipelineDeals(client, {}, "Africa/Lagos");
    const searchDeal = deals.find((d) => d.id === ids.searchDealId);
    expect(searchDeal).toBeDefined();

    const expectedDays = daysBetweenInTimezone(dealRow!.created_at, new Date().toISOString(), "Africa/Lagos");
    expect(searchDeal!.daysInCurrentStage).toBe(expectedDays);
  });

  it("a deal with a real stage_events history uses the latest event, not deals.created_at", async () => {
    const client = await signIn("m1-4-executive@example.com");
    const { data: latestEvent } = await service
      .from("stage_events")
      .select("occurred_at")
      .eq("deal_id", ids.advisoryDealId)
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const deals = await listPipelineDeals(client, {}, "Africa/Lagos");
    const advisoryDeal = deals.find((d) => d.id === ids.advisoryDealId);
    expect(advisoryDeal).toBeDefined();

    // This describe block runs before the changeStage block below (mirroring getDealDetail's own
    // ordering comment), but the fixture's find-or-create deal can already carry a stage_events
    // row from an earlier real run - so both branches (no history yet vs. real history already)
    // are handled the same way: fetch the real "since" value and recompute independently.
    const { data: dealRow } = await service.from("deals").select("created_at").eq("id", ids.advisoryDealId).single();
    const sinceIso = latestEvent?.occurred_at ?? dealRow!.created_at;
    const expectedDays = daysBetweenInTimezone(sinceIso, new Date().toISOString(), "Africa/Lagos");
    expect(advisoryDeal!.daysInCurrentStage).toBe(expectedDays);
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
    const visible = await listPipelineDeals(client, {}, "Africa/Lagos");
    expect(visible.some((d) => d.id === ids.advisoryDealId)).toBe(true);

    const result = await changeStage(client, session.actor, ids.advisoryDealId, ids.proposalStageId);
    expect(result).toEqual({ ok: false, code: "denied" });

    const { data: dealRow } = await service.from("deals").select("stage_id").eq("id", ids.advisoryDealId).single();
    expect(dealRow?.stage_id).toBe(ids.discoveryStageId);
  });

  it("the owning bde moves their deal to another open stage; exactly one audit row and one stage_events row are written", async () => {
    const client = await signIn("m1-4-bde-advisory@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    // Counts and "most recent row" lookups throughout this test are deliberately relative
    // (before/after deltas, not absolute counts) rather than exact-length assertions: this fixture
    // is find-or-create/reset for the advisory deal (see this file's header comment), so
    // audit_entries/stage_events history for it - correctly, per CLAUDE.md #4's append-only rule -
    // accumulates across every real run of this suite against the hosted project, not just once.
    const before = await service.from("deals").select("updated_at, created_at").eq("id", ids.advisoryDealId).single();
    const { data: priorStageEvents } = await service
      .from("stage_events")
      .select("occurred_at")
      .eq("deal_id", ids.advisoryDealId)
      .order("occurred_at", { ascending: false })
      .limit(1);
    const { count: auditCountBefore } = await service
      .from("audit_entries")
      .select("id", { count: "exact", head: true })
      .eq("entity_id", ids.advisoryDealId)
      .eq("action", "deal.change_stage");
    const { count: stageEventCountBefore } = await service
      .from("stage_events")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", ids.advisoryDealId);

    const result = await changeStage(client, session.actor, ids.advisoryDealId, ids.proposalStageId);
    expect(result).toEqual({ ok: true });

    // Migrations 0006 (updated_at/updated_by trigger) and 0007 (stage_events) were applied to this
    // real hosted project via the Supabase Management API's SQL endpoint, the same mechanism
    // documented in README.md's M1.1 note - closing the gap tests/integration/README.md and
    // db/migrations/README.md previously disclosed (this container still has no raw-TCP egress to
    // the database directly; a Personal Access Token was supplied ad hoc to use the Management API
    // instead). Both are now asserted on for real, not skipped.
    const { data: dealRow } = await service.from("deals").select("stage_id, updated_at, updated_by").eq("id", ids.advisoryDealId).single();
    expect(dealRow?.stage_id).toBe(ids.proposalStageId);
    expect(new Date(dealRow!.updated_at).getTime()).toBeGreaterThan(new Date(before.data!.updated_at).getTime());
    expect(dealRow?.updated_by).toBe(ids.bdeAdvisoryAuthId);

    const { data: auditRows, count: auditCountAfter } = await service
      .from("audit_entries")
      .select("action, actor_id, before, after", { count: "exact" })
      .eq("entity_id", ids.advisoryDealId)
      .eq("action", "deal.change_stage")
      .order("occurred_at", { ascending: false })
      .limit(1);
    expect(auditCountAfter).toBe((auditCountBefore ?? 0) + 1);
    expect(auditRows?.[0]).toMatchObject({
      action: "deal.change_stage",
      actor_id: ids.bdeAdvisoryAuthId,
      before: { stageId: ids.discoveryStageId },
      after: { stageId: ids.proposalStageId },
    });

    // M2.1/M2.2: changeStage's single stage_events write, verified for real against the hosted
    // project - the from/to stage ids, the actor, and the derived is_regression/
    // duration_in_previous_seconds columns migration 0007's before-insert trigger computes.
    // Discovery(sort_order 1) -> Proposal(sort_order 2) is forward, never a regression. Duration is
    // computed from the true reference point (the deal's most recent prior stage_events row if one
    // already exists from an earlier run of this suite, or deals.created_at if this is genuinely
    // the deal's first-ever transition) - not assumed to be "small," since this deal can carry real
    // history from previous runs.
    const { data: stageEventRows, count: stageEventCountAfter } = await service
      .from("stage_events")
      .select("from_stage_id, to_stage_id, actor_id, is_regression, is_reconstructed, occurred_at, duration_in_previous_seconds::text", {
        count: "exact",
      })
      .eq("deal_id", ids.advisoryDealId)
      .order("occurred_at", { ascending: false })
      .limit(1);
    expect(stageEventCountAfter).toBe((stageEventCountBefore ?? 0) + 1);
    const newEvent = stageEventRows![0]!;
    expect(newEvent).toMatchObject({
      from_stage_id: ids.discoveryStageId,
      to_stage_id: ids.proposalStageId,
      actor_id: ids.bdeAdvisoryAuthId,
      is_regression: false,
      is_reconstructed: false,
    });
    const referenceTime = priorStageEvents?.[0]?.occurred_at ?? before.data!.created_at;
    const expectedDuration = (new Date(newEvent.occurred_at).getTime() - new Date(referenceTime).getTime()) / 1000;
    // Tolerance of 5s covers the trigger's own float-to-bigint rounding (extract(epoch ...)::bigint)
    // against this recomputation's millisecond precision - not network/clock slack, since every
    // timestamp compared here is a value already committed by Postgres, never a client-side "now."
    expect(Math.abs(Number(newEvent.duration_in_previous_seconds) - expectedDuration)).toBeLessThan(5);
  });
});

// M2.4 (docs/07-build-backlog.md): "Stage-history panel on the deal, showing transitions with
// actor, date and duration." Runs after the changeStage block above so there is real, non-empty
// history to read - the advisory deal now carries at least the one Discovery -> Proposal
// transition that block's own tests wrote (plus whatever accumulated from earlier real runs of
// this suite, per this file's header comment).
describe("getStageHistory", () => {
  it("returns the deal's real stage_events history, newest first, with resolved stage/actor names", async () => {
    const client = await signIn("m1-4-bde-advisory@example.com");
    const history = await getStageHistory(client, ids.advisoryDealId);

    expect(history.length).toBeGreaterThan(0);
    // Newest first: every entry's occurred_at is >= the next one's.
    for (let i = 0; i + 1 < history.length; i++) {
      expect(new Date(history[i]!.occurredAt).getTime()).toBeGreaterThanOrEqual(new Date(history[i + 1]!.occurredAt).getTime());
    }

    const mostRecent = history[0]!;
    expect(mostRecent).toMatchObject({
      fromStageName: "Discovery",
      toStageName: "Proposal",
      actorName: "Bde Advisory",
      isRegression: false,
      isReconstructed: false,
    });
    expect(mostRecent.durationInPreviousSeconds).not.toBeNull();
  });

  it("a bde outside the deal's practice can't see its stage history - not_found reasoning, same RLS scope as the deal itself", async () => {
    const client = await signIn("m1-4-bde-search@example.com");
    const history = await getStageHistory(client, ids.advisoryDealId);
    expect(history).toHaveLength(0);
  });

  it("a deal with no transitions yet returns an empty history, not an error", async () => {
    const client = await signIn("m1-4-executive@example.com");
    const history = await getStageHistory(client, ids.searchDealId);
    expect(history).toHaveLength(0);
  });
});

// M1.7 exit criteria (docs/07-build-backlog.md): "Edit deal, with audit entries on every field
// change." Reuses advisoryDealId again, after changeStage has already moved it to Proposal above -
// none of these assertions depend on which stage it's in. Ordered so the one real edit (the last
// test) runs after every permission/scoping case, for the same reason as changeStage's own ordering.
describe("updateDeal", () => {
  const editInput = {
    name: "Advisory Pipeline Deal",
    clientType: "new" as const,
    expectedCloseDate: "2027-03-01",
    proposalValueMinor: 100_000_000n,
    negotiatedValueMinor: null,
    brief: null,
  };

  it("a bde outside the deal's practice can't even see it - not_found, same reasoning as changeStage", async () => {
    const client = await signIn("m1-4-bde-search@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await updateDeal(client, session.actor, ids.advisoryDealId, editInput);
    expect(result).toEqual({ ok: false, code: "not_found" });
  });

  it("a same-practice bde who isn't owner/co-owner/author is denied - deal.update is 'own' scoped for bde", async () => {
    const client = await signIn("m1-4-bde-advisory-2@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await updateDeal(client, session.actor, ids.advisoryDealId, editInput);
    expect(result).toEqual({ ok: false, code: "denied" });
  });

  it("an executive can see the deal (tenant-wide view) but is genuinely denied - deal.update is null for executive", async () => {
    const client = await signIn("m1-4-executive@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const visible = await getDealDetail(client, ids.advisoryDealId);
    expect(visible).not.toBeNull();

    const result = await updateDeal(client, session.actor, ids.advisoryDealId, editInput);
    expect(result).toEqual({ ok: false, code: "denied" });
  });

  it("a co-owner (not the owner) can edit - deal.update's 'own' scope includes co-owners, same as changeStage's", async () => {
    const client = await signIn("m1-4-bde-advisory-3@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const { count: auditCountBefore } = await service
      .from("audit_entries")
      .select("id", { count: "exact", head: true })
      .eq("entity_id", ids.advisoryDealId)
      .eq("action", "deal.update");

    // A no-op edit (identical values) so this doesn't disturb the "exactly one NEW audit row, only
    // the changed fields" assertion the next test makes - proves the co-owner path is allowed
    // without pre-empting what actually changes.
    const result = await updateDeal(client, session.actor, ids.advisoryDealId, editInput);
    expect(result).toEqual({ ok: true });

    // A delta, not an absolute count: this fixture reuses the same deal id across every real run of
    // this suite (see this file's header comment), so past runs' deal.update audit history for it
    // is real, expected accumulation, not a leak to assert away.
    const { count: auditCountAfter } = await service
      .from("audit_entries")
      .select("id", { count: "exact", head: true })
      .eq("entity_id", ids.advisoryDealId)
      .eq("action", "deal.update");
    expect(auditCountAfter).toBe(auditCountBefore ?? 0);
  });

  it("the owning bde edits several fields at once; the audit row's before/after contain only what changed", async () => {
    const client = await signIn("m1-4-bde-advisory@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const { count: auditCountBefore } = await service
      .from("audit_entries")
      .select("id", { count: "exact", head: true })
      .eq("entity_id", ids.advisoryDealId)
      .eq("action", "deal.update");

    const result = await updateDeal(client, session.actor, ids.advisoryDealId, {
      name: "Advisory Pipeline Deal (Revised)",
      clientType: "new",
      expectedCloseDate: "2027-03-01", // unchanged
      proposalValueMinor: 100_000_000n, // unchanged
      negotiatedValueMinor: 90_000_000n, // newly set
      brief: "Renegotiated after the discovery call.",
    });
    expect(result).toEqual({ ok: true });

    const { data: dealRow } = await service
      .from("deals")
      .select("name, negotiated_value_minor::text, brief")
      .eq("id", ids.advisoryDealId)
      .single();
    expect(dealRow).toMatchObject({
      name: "Advisory Pipeline Deal (Revised)",
      negotiated_value_minor: "90000000",
      brief: "Renegotiated after the discovery call.",
    });

    const { data: auditRows, count: auditCountAfter } = await service
      .from("audit_entries")
      .select("action, actor_id, before, after", { count: "exact" })
      .eq("entity_id", ids.advisoryDealId)
      .eq("action", "deal.update")
      .order("occurred_at", { ascending: false })
      .limit(1);
    expect(auditCountAfter).toBe((auditCountBefore ?? 0) + 1);
    expect(auditRows?.[0]).toMatchObject({
      action: "deal.update",
      actor_id: ids.bdeAdvisoryAuthId,
      before: { name: "Advisory Pipeline Deal", negotiatedValueMinor: null, brief: null },
      after: {
        name: "Advisory Pipeline Deal (Revised)",
        negotiatedValueMinor: "90000000",
        brief: "Renegotiated after the discovery call.",
      },
    });
    // expectedCloseDate/proposalValueMinor/clientType didn't change - proves the diff really is
    // field-scoped, not a snapshot of the whole submitted input.
    expect(auditRows?.[0]?.before).not.toHaveProperty("expectedCloseDate");
    expect(auditRows?.[0]?.after).not.toHaveProperty("proposalValueMinor");
  });
});
