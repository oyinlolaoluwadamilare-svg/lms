import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Shared by every integration spec whose fixture exercises a code path that calls writeAudit
// (createDeal, changeStage, and anything M1.6+ adds) - see tests/integration/README.md for the
// full diagnosis. In short: audit_entries.actor_id/tenant_id are real foreign keys, and M0.6's
// forbid_mutation() trigger blocks deleting an audit_entries row for every role including
// service_role, so a tenant/user that has ever been referenced by one becomes permanently
// un-deletable. A delete-and-recreate fixture silently fails the second time such a spec runs -
// these two helpers make the tenant and its users a permanent, find-or-create fixture instead, so
// every such spec gets this right the same way rather than re-discovering the bug independently.

// AdminUserAttributes' TS type has no `id` field, but the GoTrue admin endpoint accepts one anyway
// (confirmed directly against this project's real Auth admin API) - used by the repair path below,
// to recreate an auth identity under a specific, already-fixed public.users.id.
type CreateUserAttributes = Parameters<SupabaseClient["auth"]["admin"]["createUser"]>[0] & { id?: string };

async function createAuthUser(service: SupabaseClient, email: string, password: string, id?: string): Promise<string> {
  const attributes: CreateUserAttributes = { email, password, email_confirm: true, ...(id ? { id } : {}) };
  const { data, error } = await service.auth.admin.createUser(attributes);
  if (error) throw new Error(`create auth user ${email} failed: ${error.message}`);
  return data.user!.id;
}

export async function findOrCreateTenant(service: SupabaseClient, slug: string, name: string): Promise<string> {
  const { data: existing, error: existingError } = await service.from("tenants").select("id").eq("slug", slug).maybeSingle();
  if (existingError) throw new Error(`look up tenant failed: ${existingError.message}`);
  if (existing) return existing.id;

  const { data, error } = await service.from("tenants").insert({ name, slug }).select("id").single();
  if (error) throw new Error(`seed tenant failed: ${error.message}`);
  return data.id;
}

// Finds an existing users row for this tenant+email, or creates a fresh auth user plus users row.
// Repair case found in the wild (M1.3): a since-fixed version of a delete-and-recreate teardown had
// already deleted one user's Supabase Auth identity (admin.deleteUser is not blocked by the same FK
// that blocks deleting the public.users row) while leaving its un-deletable public.users row
// behind - public.users.id has no DB-level foreign key to auth.users.id, so the two can drift
// independently. If that's happened, signInWithPassword would fail with "Invalid login
// credentials" even though this function "found" the user; recreating the Auth identity with that
// exact id (rather than a fresh random one) repairs it in place, since every RLS policy and the
// row's own primary key already commit to it.
export async function findOrCreateUser(
  service: SupabaseClient,
  tenantId: string,
  email: string,
  fullName: string,
  password: string,
): Promise<string> {
  const { data: existing } = await service.from("users").select("id").eq("tenant_id", tenantId).eq("email", email).maybeSingle();
  if (existing) {
    const { data: authUser } = await service.auth.admin.getUserById(existing.id);
    if (!authUser?.user) {
      await createAuthUser(service, email, password, existing.id);
    }
    return existing.id;
  }

  const authId = await createAuthUser(service, email, password);
  const { error } = await service.from("users").insert({ id: authId, tenant_id: tenantId, full_name: fullName, email, status: "active" });
  if (error) throw new Error(`seed user ${email} failed: ${error.message}`);
  return authId;
}

// Generic find-or-create for any table with a natural unique key (a code, a name, a reference) -
// promoted here once a second integration spec (tests/integration/log-activity.spec.ts) needed the
// exact same logic tests/integration/pipeline-list.spec.ts's M2.1 fixture fix first introduced, for
// the same reason: once a row is referenced by an immutable child table (audit_entries,
// stage_events, and now activities), it can never be deleted again, so a real integration fixture
// against the hosted project must reuse rows across runs rather than delete-and-recreate them.
export async function findOrCreateByUniqueMatch(
  service: SupabaseClient,
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

export async function signIn(url: string, anonKey: string, email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in as ${email} failed: ${error.message}`);
  return client;
}
