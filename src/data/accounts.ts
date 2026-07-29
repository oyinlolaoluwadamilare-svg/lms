import type { SupabaseClient } from "@supabase/supabase-js";

// For an account picker on the create-deal form. Scoped entirely by RLS (accounts_select:
// practice-entitled accounts for bde/team_lead/director, tenant-wide for executive/tenant_admin) -
// no extra filtering needed here, the caller's own session already restricts the rows returned.
export async function listAccounts(supabase: SupabaseClient): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await supabase.from("accounts").select("id, name").is("deleted_at", null).order("name");

  if (error) throw new Error(`listAccounts failed: ${error.message}`);
  return data as Array<{ id: string; name: string }>;
}
