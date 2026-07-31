import type { SupabaseClient } from "@supabase/supabase-js";

// For building can()'s Resource.coOwnerIds (src/auth/permissions.ts's "own" scope token includes
// co-owners, per docs/02-permission-matrix.md) - mirrors what migration 0005's RLS policies already
// check server-side via is_deal_co_owner(), so the app-layer check and RLS move in lockstep rather
// than one recognising co-ownership and the other not.
export async function listDealCoOwnerIds(supabase: SupabaseClient, dealId: string): Promise<string[]> {
  const { data, error } = await supabase.from("deal_co_owners").select("user_id").eq("deal_id", dealId);

  if (error) throw new Error(`listDealCoOwnerIds failed: ${error.message}`);
  return (data as Array<{ user_id: string }>).map((row) => row.user_id);
}
