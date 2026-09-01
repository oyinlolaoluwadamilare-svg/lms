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

// M6.1's own "analytics.view_own" scope (docs/02-permission-matrix.md - the one grant every role
// including bde holds): "own" for a deal means owner, author or co-owner, the same three-way
// definition can()'s own "own" scope token already checks in src/auth/permissions.ts. That check is
// per-record; this is the reverse query a metrics rollup needs - every deal this one user co-owns,
// so the service layer can filter an already practice-scoped rowset down to just their own book
// without a second round trip per deal.
export async function listDealIdsCoOwnedByUser(supabase: SupabaseClient, userId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from("deal_co_owners").select("deal_id").eq("user_id", userId);

  if (error) throw new Error(`listDealIdsCoOwnedByUser failed: ${error.message}`);
  return new Set((data as Array<{ deal_id: string }>).map((row) => row.deal_id));
}
