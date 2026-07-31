import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSessionActor } from "@/services/actor";
import { createDeal } from "@/services/deals";
import { findOrCreateTenant, findOrCreateUser, signIn as signInAs } from "./support/permanentFixture";

// M1.3 exit criteria (docs/07-build-backlog.md): "Create-deal flow with Zod validation, requiring
// owner and expected close date. Author is always the creating user - the 'Unknown Author' state
// must be unrepresentable." This exercises the entire real chain, not a mock: a real Supabase Auth
// sign-in, the real RLS-scoped session client, the real can() check, the real deal insert, and the
// real audit write - against the real hosted project (src/data repositories need PostgREST; see
// tests/integration/README.md).
//
// createDeal calls writeAudit on every success, which - see tests/integration/support/
// permanentFixture.ts - makes this tenant and its users permanently un-deletable from the first run
// onward. This fixture is find-or-create/permanent for tenant + users accordingly, and
// delete-and-recreate for everything underneath that has no audit_entries FK pointing at it
// (practice_lines, pipeline_stages, accounts, user_roles, account_practice_owners - afterAll's
// deletes of those genuinely succeed every time, confirmed against the real project).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M1-3-Integration-Test-Pw1!";

let service: SupabaseClient;

const ids = {
  tenantId: "",
  practiceLineId: "",
  stageId: "",
  accountId: "",
  bdeAuthId: "",
  executiveAuthId: "",
};

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

beforeAll(async () => {
  service = createServiceClient();

  ids.tenantId = await findOrCreateTenant(service, "m1-3-integration-test", "M1.3 Integration Test Tenant");

  const { data: practiceLine, error: practiceLineError } = await service
    .from("practice_lines")
    .insert({ tenant_id: ids.tenantId, name: "Advisory", code: "ADV" })
    .select("id")
    .single();
  if (practiceLineError) throw new Error(`seed practice line failed: ${practiceLineError.message}`);
  ids.practiceLineId = practiceLine.id;

  const { data: stage, error: stageError } = await service
    .from("pipeline_stages")
    .insert({ tenant_id: ids.tenantId, name: "Discovery", code: "DISCOVERY", sort_order: 1, probability_threshold: 20 })
    .select("id")
    .single();
  if (stageError) throw new Error(`seed stage failed: ${stageError.message}`);
  ids.stageId = stage.id;

  const { data: account, error: accountError } = await service
    .from("accounts")
    .insert({ tenant_id: ids.tenantId, name: "Integration Test Client" })
    .select("id")
    .single();
  if (accountError) throw new Error(`seed account failed: ${accountError.message}`);
  ids.accountId = account.id;

  ids.bdeAuthId = await findOrCreateUser(service, ids.tenantId, "m1-3-bde@example.com", "Test Bde", PASSWORD);
  ids.executiveAuthId = await findOrCreateUser(service, ids.tenantId, "m1-3-executive@example.com", "Test Executive", PASSWORD);

  await service.from("user_roles").insert([
    { tenant_id: ids.tenantId, user_id: ids.bdeAuthId, role: "bde", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.executiveAuthId, role: "executive", practice_line_id: null },
  ]);
  await service
    .from("account_practice_owners")
    .insert({ account_id: ids.accountId, practice_line_id: ids.practiceLineId, owner_id: ids.bdeAuthId });
});

afterAll(async () => {
  await service.from("deals").delete().eq("tenant_id", ids.tenantId);
  await service.from("account_practice_owners").delete().eq("account_id", ids.accountId);
  await service.from("accounts").delete().eq("tenant_id", ids.tenantId);
  await service.from("pipeline_stages").delete().eq("tenant_id", ids.tenantId);
  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  await service.from("practice_lines").delete().eq("tenant_id", ids.tenantId);
  // Deliberately not deleting users, tenants, or the auth users: once this suite's first-ever run
  // writes an audit_entries row for them, they are permanently un-deletable (see beforeAll comment).
  // Attempting it here would just be a silent no-op every time - this fixture is permanent by design.
});

describe("createDeal, end to end against a real signed-in session", () => {
  it("a bde creates a deal in their own practice; author is always themself", async () => {
    const client = await signIn("m1-3-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await createDeal(client, session.actor, {
      name: "Real Chain Test Deal",
      accountId: ids.accountId,
      practiceLineId: ids.practiceLineId,
      stageId: ids.stageId,
      clientType: "new",
      ownerId: ids.bdeAuthId,
      expectedCloseDate: "2027-06-01",
      proposalValueMinor: 500_000_00n,
      currencyCode: "NGN",
      brief: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deal.reference).toBe("D-0001");

    const { data: dealRow } = await service
      .from("deals")
      .select("author_id, created_by, owner_id")
      .eq("id", result.deal.id)
      .single();
    expect(dealRow?.author_id).toBe(ids.bdeAuthId);
    expect(dealRow?.created_by).toBe(ids.bdeAuthId);

    const { data: auditRows } = await service
      .from("audit_entries")
      .select("action, actor_id, entity_id")
      .eq("entity_id", result.deal.id);
    expect(auditRows).toHaveLength(1);
    expect(auditRows?.[0]).toMatchObject({ action: "deal.create", actor_id: ids.bdeAuthId, entity_id: result.deal.id });
  });

  it("executive cannot create a deal - denied before any insert is attempted", async () => {
    const client = await signIn("m1-3-executive@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await createDeal(client, session.actor, {
      name: "Should Never Exist",
      accountId: ids.accountId,
      practiceLineId: ids.practiceLineId,
      stageId: ids.stageId,
      clientType: "new",
      ownerId: ids.bdeAuthId,
      expectedCloseDate: "2027-06-01",
      proposalValueMinor: null,
      currencyCode: "NGN",
      brief: null,
    });

    expect(result).toEqual({ ok: false, code: "denied" });

    const { count } = await service
      .from("deals")
      .select("id", { count: "exact", head: true })
      .eq("name", "Should Never Exist");
    expect(count).toBe(0);
  });
});
