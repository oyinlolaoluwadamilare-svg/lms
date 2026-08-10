import type { SupabaseClient } from "@supabase/supabase-js";

// For an account picker on the create-deal form. Scoped entirely by RLS (accounts_select:
// practice-entitled accounts for bde/team_lead/director, tenant-wide for executive/tenant_admin) -
// no extra filtering needed here, the caller's own session already restricts the rows returned.
export async function listAccounts(supabase: SupabaseClient): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await supabase.from("accounts").select("id, name").is("deleted_at", null).order("name");

  if (error) throw new Error(`listAccounts failed: ${error.message}`);
  return data as Array<{ id: string; name: string }>;
}

// For src/services/contacts.ts's own practice-entitlement check (M5.5) - an account can be owned by
// MORE than one practice line (account_practice_owners is a many-to-many, migration 0005's own
// "practice lines that sell into the same client" reasoning), so contact.create/contact.update's
// "practice" scope can't be expressed as a single practiceLineId on can()'s Resource the way a
// deal's own single practice_line_id can. This returns every practice line entitled to the account;
// the caller checks membership against its own role grants directly, the same way
// account_has_entitled_practice() computes the equivalent set at the RLS layer.
export async function listPracticeLineIdsForAccount(supabase: SupabaseClient, accountId: string): Promise<string[]> {
  const { data, error } = await supabase.from("account_practice_owners").select("practice_line_id").eq("account_id", accountId);

  if (error) throw new Error(`listPracticeLineIdsForAccount failed: ${error.message}`);
  return (data as Array<{ practice_line_id: string }>).map((row) => row.practice_line_id);
}
