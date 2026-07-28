import type { SupabaseClient } from "@supabase/supabase-js";

// Scoped by RLS (tenants_select: id = current_tenant_id()) - a user only ever reads their own
// tenant row anyway, this just picks the one display field the shell header needs.
export async function getTenantName(supabase: SupabaseClient, tenantId: string): Promise<string> {
  const { data, error } = await supabase.from("tenants").select("name").eq("id", tenantId).single();
  if (error) throw new Error(`getTenantName failed: ${error.message}`);
  return (data as { name: string }).name;
}
