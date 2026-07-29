import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { countDealsForTenant, getDealWithStage, nextDealReference } from "@/data/deals";

// M1.2 exit criteria (docs/07-build-backlog.md): "Deal repository and domain logic: probability
// resolution, weighted value, reference generation." This is the integration layer
// (docs/05-test-strategy.md: "Integration | repositories, triggers, derived fields") for
// src/data/deals.ts specifically. Runs against the real Supabase project - this container has no
// Docker daemon for a local `supabase start` stack, and the bare local Postgres used by tests/rls
// has no PostgREST, which src/data's Supabase-client-based repositories need. Uses its own
// dedicated tenant, created and torn down here - never touches db/seed's demo tenants.

let supabase: SupabaseClient;

const ids = {
  tenantId: "",
  practiceLineId: "",
  stageId: "",
  accountId: "",
  userId: "",
  dealLargeValueId: "",
};

// Above Number.MAX_SAFE_INTEGER (9007199254740991) - the exact case that motivated the ::text
// cast in src/data/deals.ts. If that cast were ever removed, this value would come back rounded.
const LARGE_VALUE_MINOR = 9_007_199_254_740_993n;

async function cleanup() {
  if (!ids.tenantId) return;
  await supabase.from("deals").delete().eq("tenant_id", ids.tenantId);
  await supabase.from("account_practice_owners").delete().eq("account_id", ids.accountId);
  await supabase.from("accounts").delete().eq("tenant_id", ids.tenantId);
  await supabase.from("pipeline_stages").delete().eq("tenant_id", ids.tenantId);
  await supabase.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  await supabase.from("users").delete().eq("tenant_id", ids.tenantId);
  await supabase.from("practice_lines").delete().eq("tenant_id", ids.tenantId);
  await supabase.from("tenants").delete().eq("id", ids.tenantId);
}

beforeAll(async () => {
  supabase = createServiceClient();

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({ name: "M1.2 Integration Test Tenant", slug: "m1-2-integration-test" })
    .select("id")
    .single();
  if (tenantError) throw new Error(`seed tenant failed: ${tenantError.message}`);
  ids.tenantId = tenant.id;

  const { data: practiceLine, error: practiceLineError } = await supabase
    .from("practice_lines")
    .insert({ tenant_id: ids.tenantId, name: "Advisory", code: "ADV" })
    .select("id")
    .single();
  if (practiceLineError) throw new Error(`seed practice line failed: ${practiceLineError.message}`);
  ids.practiceLineId = practiceLine.id;

  const { data: stage, error: stageError } = await supabase
    .from("pipeline_stages")
    .insert({
      tenant_id: ids.tenantId,
      name: "Discovery",
      code: "DISCOVERY",
      sort_order: 1,
      probability_threshold: 20,
    })
    .select("id")
    .single();
  if (stageError) throw new Error(`seed stage failed: ${stageError.message}`);
  ids.stageId = stage.id;

  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .insert({ tenant_id: ids.tenantId, name: "Integration Test Client" })
    .select("id")
    .single();
  if (accountError) throw new Error(`seed account failed: ${accountError.message}`);
  ids.accountId = account.id;

  // A real users row is needed as author_id/owner_id (FK to users), but not a real auth identity
  // - nothing here signs in, so no matching Supabase Auth user is created. users.id has no
  // default (migration 0002: it's meant to equal a real auth.users.id), so it must be supplied.
  const { data: user, error: userError } = await supabase
    .from("users")
    .insert({
      id: crypto.randomUUID(),
      tenant_id: ids.tenantId,
      full_name: "Integration Test User",
      email: "integration-test-user@example.com",
      status: "active",
    })
    .select("id")
    .single();
  if (userError) throw new Error(`seed user failed: ${userError.message}`);
  ids.userId = user.id;
  await supabase
    .from("account_practice_owners")
    .insert({ account_id: ids.accountId, practice_line_id: ids.practiceLineId, owner_id: ids.userId });

  const { data: deal, error: dealError } = await supabase
    .from("deals")
    .insert({
      tenant_id: ids.tenantId,
      reference: "D-9999",
      name: "Large Value Deal",
      account_id: ids.accountId,
      practice_line_id: ids.practiceLineId,
      stage_id: ids.stageId,
      client_type: "new",
      owner_id: ids.userId,
      author_id: ids.userId,
      status: "active",
      expected_close_date: "2027-01-01",
      proposal_value_minor: LARGE_VALUE_MINOR.toString(),
      currency_code: "NGN",
    })
    .select("id")
    .single();
  if (dealError) throw new Error(`seed deal failed: ${dealError.message}`);
  ids.dealLargeValueId = deal.id;
});

afterAll(cleanup);

describe("getDealWithStage", () => {
  it("resolves a large proposal_value_minor without precision loss", async () => {
    const result = await getDealWithStage(supabase, ids.dealLargeValueId);
    expect(result).not.toBeNull();
    expect(result?.deal.proposalValueMinor).toBe(LARGE_VALUE_MINOR);
    expect(result?.deal.negotiatedValueMinor).toBeNull();
    expect(result?.deal.currencyCode).toBe("NGN");
    expect(result?.deal.probabilityOverride).toBeNull();
    expect(result?.stage.probabilityThreshold).toBe(20);
  });

  it("returns null for a deal id that does not exist", async () => {
    const result = await getDealWithStage(supabase, "00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });
});

describe("countDealsForTenant / nextDealReference", () => {
  it("counts the one seeded deal and proposes the next reference", async () => {
    const count = await countDealsForTenant(supabase, ids.tenantId);
    expect(count).toBe(1);

    const reference = await nextDealReference(supabase, ids.tenantId);
    expect(reference).toBe("D-0002");
  });

  it("advances after another deal is inserted", async () => {
    const { data: secondDeal, error } = await supabase
      .from("deals")
      .insert({
        tenant_id: ids.tenantId,
        reference: "D-0002",
        name: "Second Deal",
        account_id: ids.accountId,
        practice_line_id: ids.practiceLineId,
        stage_id: ids.stageId,
        client_type: "existing",
        author_id: ids.userId,
        status: "on_hold",
      })
      .select("id")
      .single();
    expect(error).toBeNull();

    const reference = await nextDealReference(supabase, ids.tenantId);
    expect(reference).toBe("D-0003");

    await supabase.from("deals").delete().eq("id", secondDeal!.id);
  });

  it("counting a different (nonexistent) tenant returns zero, not the whole table", async () => {
    const count = await countDealsForTenant(supabase, "00000000-0000-0000-0000-000000000000");
    expect(count).toBe(0);
  });
});
