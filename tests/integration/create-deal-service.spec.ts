import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSessionActor } from "@/services/actor";
import { createDeal } from "@/services/deals";

// M1.3 exit criteria (docs/07-build-backlog.md): "Create-deal flow with Zod validation, requiring
// owner and expected close date. Author is always the creating user - the 'Unknown Author' state
// must be unrepresentable." This exercises the entire real chain, not a mock: a real Supabase Auth
// sign-in, the real RLS-scoped session client, the real can() check, the real deal insert, and the
// real audit write - against the real hosted project (src/data repositories need PostgREST; see
// tests/integration/README.md). Its own dedicated tenant, torn down afterward.

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

// AdminUserAttributes' TS type has no `id` field, but the GoTrue admin endpoint accepts one anyway
// (confirmed directly against this project's real Auth admin API) - used only by the repair path
// below, to recreate an auth identity under a specific, already-fixed public.users.id.
type CreateUserAttributes = Parameters<SupabaseClient["auth"]["admin"]["createUser"]>[0] & { id?: string };

async function createAuthUser(email: string, id?: string) {
  const attributes: CreateUserAttributes = { email, password: PASSWORD, email_confirm: true, ...(id ? { id } : {}) };
  const { data, error } = await service.auth.admin.createUser(attributes);
  if (error) throw new Error(`create auth user ${email} failed: ${error.message}`);
  return data.user!.id;
}

// Finds an existing users row for this tenant+email, or creates a fresh auth user plus users row.
// Needed because - see the beforeAll comment below - a user that has ever authored an audit entry
// can never be hard-deleted, so a second run of this suite must reuse it rather than re-insert it.
//
// Repair case found in the wild: this suite's *previous* (pre-fix) version of afterAll deleted the
// Supabase Auth identity via admin.deleteUser even though it could never delete the matching
// public.users row (blocked by the audit_entries FK, same as tenants). public.users.id has no
// DB-level foreign key to auth.users(id), so those two can drift independently - and did: a
// public.users row survived here with no corresponding auth user, so signInWithPassword failed
// with "Invalid login credentials" even though findOrCreateUser had "found" the user. Recreating
// the auth identity with that exact id (rather than a fresh random one) repairs it in place,
// because that id is what every RLS policy and this row's own primary key already commit to.
async function findOrCreateUser(tenantId: string, email: string, fullName: string): Promise<string> {
  const { data: existing } = await service.from("users").select("id").eq("tenant_id", tenantId).eq("email", email).maybeSingle();
  if (existing) {
    const { data: authUser } = await service.auth.admin.getUserById(existing.id);
    if (!authUser?.user) {
      await createAuthUser(email, existing.id);
    }
    return existing.id;
  }

  const authId = await createAuthUser(email);
  const { error } = await service.from("users").insert({ id: authId, tenant_id: tenantId, full_name: fullName, email, status: "active" });
  if (error) throw new Error(`seed user ${email} failed: ${error.message}`);
  return authId;
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign in as ${email} failed: ${error.message}`);
  return client;
}

beforeAll(async () => {
  service = createServiceClient();

  // Idempotency note (found the hard way): db/migrations/0004's forbid_mutation() trigger blocks
  // deleting an audit_entries row for every role, including service_role - by design, that is the
  // entire point of M0.6. audit_entries.actor_id and audit_entries.tenant_id are real foreign keys
  // to users(id) and tenants(id) (confirmed via pg_constraint). So the instant this suite's "bde
  // creates a deal" test runs createDeal -> writeAudit once, the bde user and this tenant become
  // permanently un-deletable - afterAll's delete calls on them fail silently (error unchecked) and
  // leave them behind. Rather than fight that, this fixture is find-or-create/permanent for
  // tenant + users, and delete-and-recreate for everything underneath that has no audit_entries FK
  // pointing at it (practice_lines, pipeline_stages, accounts, user_roles, account_practice_owners -
  // afterAll's deletes of those genuinely succeed every time, confirmed against the real project).
  const { data: existingTenant, error: existingTenantError } = await service
    .from("tenants")
    .select("id")
    .eq("slug", "m1-3-integration-test")
    .maybeSingle();
  if (existingTenantError) throw new Error(`look up tenant failed: ${existingTenantError.message}`);

  if (existingTenant) {
    ids.tenantId = existingTenant.id;
  } else {
    const { data: tenant, error: tenantError } = await service
      .from("tenants")
      .insert({ name: "M1.3 Integration Test Tenant", slug: "m1-3-integration-test" })
      .select("id")
      .single();
    if (tenantError) throw new Error(`seed tenant failed: ${tenantError.message}`);
    ids.tenantId = tenant.id;
  }

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

  ids.bdeAuthId = await findOrCreateUser(ids.tenantId, "m1-3-bde@example.com", "Test Bde");
  ids.executiveAuthId = await findOrCreateUser(ids.tenantId, "m1-3-executive@example.com", "Test Executive");

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
