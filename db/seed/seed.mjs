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
// and recreates rows/auth-users matching the fixed slugs/emails below every time it runs.
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

async function createAuthUser(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`create auth user ${email} failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return body.id;
}

async function deleteExistingTenant(slug) {
  const { data: tenant, error } = await supabase.from("tenants").select("id").eq("slug", slug).maybeSingle();
  if (error) throw new Error(`lookup tenant ${slug} failed: ${error.message}`);
  if (!tenant) return;

  const { data: users, error: usersError } = await supabase.from("users").select("id, email").eq("tenant_id", tenant.id);
  if (usersError) throw new Error(`lookup users for ${slug} failed: ${usersError.message}`);

  await supabase.from("user_roles").delete().eq("tenant_id", tenant.id);
  await supabase.from("users").delete().eq("tenant_id", tenant.id);
  await supabase.from("practice_lines").delete().eq("tenant_id", tenant.id);
  await supabase.from("tenants").delete().eq("id", tenant.id);

  for (const user of users ?? []) {
    const authId = await findAuthUserIdByEmail(user.email);
    if (authId) await deleteAuthUser(authId);
  }
  console.log(`  cleared existing '${slug}'`);
}

async function createTenant(slug, name) {
  const { data, error } = await supabase.from("tenants").insert({ slug, name }).select("id").single();
  if (error) throw new Error(`create tenant ${slug} failed: ${error.message}`);
  return data.id;
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

async function createUserWithRole(tenantId, email, fullName, role, practiceLineId, status = "active") {
  const authId = await createAuthUser(email, DEMO_PASSWORD);
  const { error: userError } = await supabase
    .from("users")
    .insert({ id: authId, tenant_id: tenantId, full_name: fullName, email, status });
  if (userError) throw new Error(`create users row for ${email} failed: ${userError.message}`);

  const { error: roleError } = await supabase
    .from("user_roles")
    .insert({ tenant_id: tenantId, user_id: authId, role, practice_line_id: practiceLineId });
  if (roleError) throw new Error(`grant role for ${email} failed: ${roleError.message}`);

  return authId;
}

async function main() {
  console.log(`Seeding ${SUPABASE_URL} ...`);

  for (const t of TENANTS) {
    await deleteExistingTenant(t.slug);
  }

  const [acme, globex] = TENANTS;

  const acmeTenantId = await createTenant(acme.slug, acme.name);
  const acmePracticeIds = await createPracticeLines(acmeTenantId, acme.practiceLines);
  const [advisoryA, execSearchA] = acmePracticeIds;

  await createUserWithRole(acmeTenantId, "tenant-admin@acme-demo.test", "Ada Admin", "tenant_admin", null);
  await createUserWithRole(acmeTenantId, "executive@acme-demo.test", "Elliot Executive", "executive", null);
  await createUserWithRole(acmeTenantId, "director@acme-demo.test", "Dana Director", "director", advisoryA);
  await createUserWithRole(acmeTenantId, "team-lead@acme-demo.test", "Tom TeamLead", "team_lead", advisoryA);
  await createUserWithRole(acmeTenantId, "bde-1@acme-demo.test", "Blake Bde", "bde", advisoryA);
  await createUserWithRole(acmeTenantId, "bde-2@acme-demo.test", "Bella Bde", "bde", execSearchA ?? advisoryA);
  await createUserWithRole(acmeTenantId, "suspended@acme-demo.test", "Sam Suspended", "bde", advisoryA, "suspended");

  const globexTenantId = await createTenant(globex.slug, globex.name);
  await createPracticeLines(globexTenantId, globex.practiceLines);
  await createUserWithRole(globexTenantId, "tenant-admin@globex-demo.test", "Gabby AdminB", "tenant_admin", null);

  console.log("Seed complete.");
  console.log(`Sign in at /sign-in with any *.test address above, password: ${DEMO_PASSWORD}`);
  console.log("(e.g. tenant-admin@acme-demo.test, director@acme-demo.test, bde-1@acme-demo.test)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
