import type { SupabaseClient } from "@supabase/supabase-js";

// Scoped by RLS (tenants_select: id = current_tenant_id()) - a user only ever reads their own
// tenant row anyway, this just picks the one display field the shell header needs.
export async function getTenantName(supabase: SupabaseClient, tenantId: string): Promise<string> {
  const { data, error } = await supabase.from("tenants").select("name").eq("id", tenantId).single();
  if (error) throw new Error(`getTenantName failed: ${error.message}`);
  return (data as { name: string }).name;
}

// tenants.timezone (migration 0002) always has a value (not-null, defaults to 'Africa/Lagos') -
// this is the fallback half of src/lib/dates.ts's resolveTimezone, the other half being a user's
// own users.timezone override.
export async function getTenantTimezone(supabase: SupabaseClient, tenantId: string): Promise<string> {
  const { data, error } = await supabase.from("tenants").select("timezone").eq("id", tenantId).single();
  if (error) throw new Error(`getTenantTimezone failed: ${error.message}`);
  return (data as { timezone: string }).timezone;
}
