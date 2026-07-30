import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { listPipelineDeals } from "@/services/deals";

// M1.4 exit criteria (docs/07-build-backlog.md): "Pipeline table view with the advanced filter
// set." This proves src/data/deals.ts's listDeals (via src/services/deals.ts's listPipelineDeals)
// against the real hosted project: the money-precision-safe join (pipeline_stages/accounts/
// practice_lines/owner), every filter actually narrows results, and - the part a service-role-only
// test cannot prove - that migration 0005's deals_select RLS policy really does scope a signed-in
// bde to their own practice line while an executive sees the whole tenant. No deal here is created
// via createDeal (a plain service-role insert instead), so no audit_entries row ever references
// this fixture's tenant/users - unlike tests/integration/create-deal-service.spec.ts, this tenant
// is fully torn down every run (see that file's README note on why that one can't be).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M1-4-Integration-Test-Pw1!";

let service: SupabaseClient;

const ids = {
  tenantId: "",
  advisoryPracticeLineId: "",
  searchPracticeLineId: "",
  discoveryStageId: "",
  wonStageId: "",
  lostStageId: "",
  advisoryAccountId: "",
  searchAccountId: "",
  bdeAdvisoryAuthId: "",
  bdeSearchAuthId: "",
  executiveAuthId: "",
  advisoryDealId: "",
  searchDealId: "",
};

async function cleanup() {
  if (!ids.tenantId) return;
  await service.from("deals").delete().eq("tenant_id", ids.tenantId);
  await service.from("account_practice_owners").delete().in("account_id", [ids.advisoryAccountId, ids.searchAccountId]);
  await service.from("accounts").delete().eq("tenant_id", ids.tenantId);
  await service.from("pipeline_stages").delete().eq("tenant_id", ids.tenantId);
  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  await service.from("users").delete().eq("tenant_id", ids.tenantId);
  await service.from("practice_lines").delete().eq("tenant_id", ids.tenantId);
  await service.from("tenants").delete().eq("id", ids.tenantId);
  if (ids.bdeAdvisoryAuthId) await service.auth.admin.deleteUser(ids.bdeAdvisoryAuthId);
  if (ids.bdeSearchAuthId) await service.auth.admin.deleteUser(ids.bdeSearchAuthId);
  if (ids.executiveAuthId) await service.auth.admin.deleteUser(ids.executiveAuthId);
}

async function createAuthUser(email: string) {
  const { data, error } = await service.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`create auth user ${email} failed: ${error.message}`);
  return data.user!.id;
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign in as ${email} failed: ${error.message}`);
  return client;
}

beforeAll(async () => {
  service = createServiceClient();

  const { data: tenant, error: tenantError } = await service
    .from("tenants")
    .insert({ name: "M1.4 Integration Test Tenant", slug: "m1-4-integration-test" })
    .select("id")
    .single();
  if (tenantError) throw new Error(`seed tenant failed: ${tenantError.message}`);
  ids.tenantId = tenant.id;

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
      { tenant_id: ids.tenantId, name: "Closed Won", code: "WON", sort_order: 2, probability_threshold: 100, stage_type: "won" },
      { tenant_id: ids.tenantId, name: "Closed Lost", code: "LOST", sort_order: 3, probability_threshold: 0, stage_type: "lost" },
    ])
    .select("id, code");
  if (stagesError) throw new Error(`seed stages failed: ${stagesError.message}`);
  ids.discoveryStageId = stages!.find((s) => s.code === "DISCOVERY")!.id;
  ids.wonStageId = stages!.find((s) => s.code === "WON")!.id;
  ids.lostStageId = stages!.find((s) => s.code === "LOST")!.id;

  const { data: accounts, error: accountsError } = await service
    .from("accounts")
    .insert([
      { tenant_id: ids.tenantId, name: "Advisory Client" },
      { tenant_id: ids.tenantId, name: "Search Client" },
    ])
    .select("id, name");
  if (accountsError) throw new Error(`seed accounts failed: ${accountsError.message}`);
  ids.advisoryAccountId = accounts!.find((a) => a.name === "Advisory Client")!.id;
  ids.searchAccountId = accounts!.find((a) => a.name === "Search Client")!.id;

  ids.bdeAdvisoryAuthId = await createAuthUser("m1-4-bde-advisory@example.com");
  ids.bdeSearchAuthId = await createAuthUser("m1-4-bde-search@example.com");
  ids.executiveAuthId = await createAuthUser("m1-4-executive@example.com");

  const { error: usersError } = await service.from("users").insert([
    { id: ids.bdeAdvisoryAuthId, tenant_id: ids.tenantId, full_name: "Bde Advisory", email: "m1-4-bde-advisory@example.com", status: "active" },
    { id: ids.bdeSearchAuthId, tenant_id: ids.tenantId, full_name: "Bde Search", email: "m1-4-bde-search@example.com", status: "active" },
    { id: ids.executiveAuthId, tenant_id: ids.tenantId, full_name: "Test Executive", email: "m1-4-executive@example.com", status: "active" },
  ]);
  if (usersError) throw new Error(`seed users failed: ${usersError.message}`);

  await service.from("user_roles").insert([
    { tenant_id: ids.tenantId, user_id: ids.bdeAdvisoryAuthId, role: "bde", practice_line_id: ids.advisoryPracticeLineId },
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
