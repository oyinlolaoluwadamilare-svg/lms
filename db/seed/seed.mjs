#!/usr/bin/env node
// Deterministic local/dev seed: two tenants, a small set of practice lines, and users covering
// every role (docs/07-build-backlog.md M0.8). Scoped to what exists so far - tenants,
// practice_lines, users, user_roles. is_demo columns and the metric-exclusion CI check
// (docs/05-test-strategy.md's full seed spec) are deferred: is_demo only exists on
// accounts/contacts/deals/leads/tasks (docs/01-domain-model.md), none of which are migrated yet,
// and there are no metric queries until M7.
//
// Creates real Supabase Auth users via the Admin API (service_role), so every seeded user can
// actually sign in through /sign-in. NEVER point this at a real production project - it deletes
// and recreates rows/auth-users matching the fixed slugs/emails below every time it runs, with one
// exception: once a real audit-writing action (createDeal, changeStage, ...) has ever been
// performed against a demo tenant or one of its users, that tenant/user becomes permanently
// un-deletable (CLAUDE.md #3/#6 - see ensureTenant's comment below) and this script reuses it
// instead of failing. Everything else under a reused tenant (practice_lines, accounts,
// pipeline_stages, deals, user_roles) is still cleared and recreated fresh every run.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CONFIRM_FLAG = "--yes-i-know-this-writes-to-the-configured-project";
const DEMO_PASSWORD = "Demo-Password-1!";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are both required.");
  process.exit(1);
}

if (!process.argv.includes(CONFIRM_FLAG)) {
  console.error(
    `Refusing to run without ${CONFIRM_FLAG}.\n` +
      `This deletes and recreates demo tenants/users/auth-users at ${SUPABASE_URL}.\n` +
      "Never point this at a real production project.",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TENANTS = [
  {
    slug: "acme-demo",
    name: "Acme Consulting (Demo)",
    practiceLines: ["Advisory", "Executive Search", "Learning & Development", "Outsourcing"],
  },
  { slug: "globex-demo", name: "Globex Advisory (Demo)", practiceLines: ["Advisory"] },
];

async function findAuthUserIdByEmail(email) {
  for (let page = 1; ; page += 1) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!res.ok) throw new Error(`list auth users failed: ${res.status} ${await res.text()}`);
    const body = await res.json();
    const users = body.users ?? [];
    const match = users.find((u) => u.email === email);
    if (match) return match.id;
    if (users.length < 200) return null;
  }
}

async function deleteAuthUser(id) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: "DELETE",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`delete auth user ${id} failed: ${res.status} ${await res.text()}`);
  }
}

// `id` is optional and not part of GoTrue's documented/typed request shape, but the admin endpoint
// accepts one anyway (confirmed directly against this project's real Auth admin API) - used to
// repair a users row whose Auth identity has drifted away. See
// tests/integration/support/permanentFixture.ts for the full story: public.users.id has no
// DB-level FK to auth.users.id, so the two can drift independently if something ever deletes one
// without the other.
async function createAuthUser(email, password, id) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true, ...(id ? { id } : {}) }),
  });
  if (!res.ok) throw new Error(`create auth user ${email} failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return body.id;
}

// Deletes everything under a tenant that has no audit_entries foreign key pointing at it - always
// safe to attempt, regardless of whether the tenant/users themselves turn out to be deletable.
// M1.1 added deals/accounts/account_practice_owners/pipeline_stages after this script was first
// written, and it never learned about them - a real gap, not a deliberate scope cut, made visible
// the moment demo data started existing in those tables.
async function clearTenantData(tenantId) {
  await supabase.from("deals").delete().eq("tenant_id", tenantId);
  const { data: accounts } = await supabase.from("accounts").select("id").eq("tenant_id", tenantId);
  if (accounts?.length) {
    await supabase.from("account_practice_owners").delete().in(
      "account_id",
      accounts.map((a) => a.id),
    );
  }
  await supabase.from("accounts").delete().eq("tenant_id", tenantId);
  await supabase.from("pipeline_stages").delete().eq("tenant_id", tenantId);
  await supabase.from("user_roles").delete().eq("tenant_id", tenantId);
  await supabase.from("practice_lines").delete().eq("tenant_id", tenantId);
}

// Returns the tenant id to use - either a freshly created one, or an existing one that could not
// be hard-deleted. Once any real action against this demo tenant writes an audit_entries row
// (actor_id/tenant_id are real foreign keys, and M0.6's forbid_mutation() trigger blocks deleting
// that row for every role including service_role), the tenant and the users it references become
// permanently un-deletable - the exact same discovery M1.3's integration test fixture made,
// applying here too now that a real feature (M1.5's changeStage) has been exercised against this
// demo tenant at least once. Falls back to reusing the tenant rather than failing the whole script,
// since demo/seed data existing at all is what this script is for - it should degrade, not break.
async function ensureTenant(slug, name) {
  const { data: tenant, error } = await supabase.from("tenants").select("id").eq("slug", slug).maybeSingle();
  if (error) throw new Error(`lookup tenant ${slug} failed: ${error.message}`);

  if (!tenant) {
    const { data, error: createError } = await supabase.from("tenants").insert({ slug, name }).select("id").single();
    if (createError) throw new Error(`create tenant ${slug} failed: ${createError.message}`);
    return data.id;
  }

  const { data: users, error: usersError } = await supabase.from("users").select("id, email").eq("tenant_id", tenant.id);
  if (usersError) throw new Error(`lookup users for ${slug} failed: ${usersError.message}`);

  await clearTenantData(tenant.id);

  const { error: usersDeleteError } = await supabase.from("users").delete().eq("tenant_id", tenant.id);
  const { error: tenantDeleteError } = await supabase.from("tenants").delete().eq("id", tenant.id);

  if (!usersDeleteError && !tenantDeleteError) {
    for (const user of users ?? []) {
      const authId = await findAuthUserIdByEmail(user.email);
      if (authId) await deleteAuthUser(authId);
    }
    console.log(`  cleared existing '${slug}'`);
    const { data, error: createError } = await supabase.from("tenants").insert({ slug, name }).select("id").single();
    if (createError) throw new Error(`create tenant ${slug} failed: ${createError.message}`);
    return data.id;
  }

  console.log(
    `  '${slug}' has audited history and can't be hard-deleted (CLAUDE.md #3/#6) - reusing the existing tenant and its users`,
  );
  return tenant.id;
}

async function createPracticeLines(tenantId, names) {
  const rows = names.map((name, i) => ({
    tenant_id: tenantId,
    name,
    code: name.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4) || `PL${i}`,
    sort_order: i,
  }));
  const { data, error } = await supabase.from("practice_lines").insert(rows).select("id");
  if (error) throw new Error(`create practice lines for tenant ${tenantId} failed: ${error.message}`);
  return data.map((row) => row.id);
}

// Finds an existing users row for this tenant+email and reuses it (repairing its Auth identity
// first if that's drifted away - see createAuthUser's comment), or creates both fresh. Works
// unconditionally for a brand-new tenant too (nothing to find, so it always falls through to
// create) - the same idempotent shape as tests/integration/support/permanentFixture.ts's
// findOrCreateUser, for the same reason: any user this script seeds might have had a real,
// audit-writing action performed against it (as bde-1@acme-demo.test did here, via M1.5's
// changeStage), making it permanently un-deletable from then on.
async function ensureUserWithRole(tenantId, email, fullName, role, practiceLineId, status = "active") {
  const { data: existing, error: existingError } = await supabase
    .from("users")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("email", email)
    .maybeSingle();
  if (existingError) throw new Error(`lookup user ${email} failed: ${existingError.message}`);

  let authId;
  if (existing) {
    const authUser = await findAuthUserIdByEmail(email);
    authId = authUser ?? (await createAuthUser(email, DEMO_PASSWORD, existing.id));
    if (authId !== existing.id) {
      throw new Error(`auth id for ${email} (${authId}) does not match existing users.id (${existing.id})`);
    }
  } else {
    authId = await createAuthUser(email, DEMO_PASSWORD);
    const { error: userError } = await supabase
      .from("users")
      .insert({ id: authId, tenant_id: tenantId, full_name: fullName, email, status });
    if (userError) throw new Error(`create users row for ${email} failed: ${userError.message}`);
  }

  const { error: roleError } = await supabase
    .from("user_roles")
    .insert({ tenant_id: tenantId, user_id: authId, role, practice_line_id: practiceLineId });
  if (roleError) throw new Error(`grant role for ${email} failed: ${roleError.message}`);

  return authId;
}

async function main() {
  console.log(`Seeding ${SUPABASE_URL} ...`);

  const [acme, globex] = TENANTS;

  const acmeTenantId = await ensureTenant(acme.slug, acme.name);
  const acmePracticeIds = await createPracticeLines(acmeTenantId, acme.practiceLines);
  const [advisoryA, execSearchA] = acmePracticeIds;

  await ensureUserWithRole(acmeTenantId, "tenant-admin@acme-demo.test", "Ada Admin", "tenant_admin", null);
  await ensureUserWithRole(acmeTenantId, "executive@acme-demo.test", "Elliot Executive", "executive", null);
  await ensureUserWithRole(acmeTenantId, "director@acme-demo.test", "Dana Director", "director", advisoryA);
  await ensureUserWithRole(acmeTenantId, "team-lead@acme-demo.test", "Tom TeamLead", "team_lead", advisoryA);
  await ensureUserWithRole(acmeTenantId, "bde-1@acme-demo.test", "Blake Bde", "bde", advisoryA);
  await ensureUserWithRole(acmeTenantId, "bde-2@acme-demo.test", "Bella Bde", "bde", execSearchA ?? advisoryA);
  await ensureUserWithRole(acmeTenantId, "suspended@acme-demo.test", "Sam Suspended", "bde", advisoryA, "suspended");

  const globexTenantId = await ensureTenant(globex.slug, globex.name);
  await createPracticeLines(globexTenantId, globex.practiceLines);
  await ensureUserWithRole(globexTenantId, "tenant-admin@globex-demo.test", "Gabby AdminB", "tenant_admin", null);

  console.log("Seed complete.");
  console.log(`Sign in at /sign-in with any *.test address above, password: ${DEMO_PASSWORD}`);
  console.log("(e.g. tenant-admin@acme-demo.test, director@acme-demo.test, bde-1@acme-demo.test)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
