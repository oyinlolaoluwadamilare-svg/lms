import type { SupabaseClient } from "@supabase/supabase-js";

export type OutcomeType = "win" | "loss";

export interface OutcomeReason {
  id: string;
  type: OutcomeType;
  label: string;
  sortOrder: number;
  isActive: boolean;
  requiresCompetitorName: boolean;
}

interface OutcomeReasonRow {
  id: string;
  type: OutcomeType;
  label: string;
  sort_order: number;
  is_active: boolean;
  requires_competitor_name: boolean;
}

const OUTCOME_REASON_COLUMNS = "id, type, label, sort_order, is_active, requires_competitor_name";

function toDomain(row: OutcomeReasonRow): OutcomeReason {
  return {
    id: row.id,
    type: row.type,
    label: row.label,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    requiresCompetitorName: row.requires_competitor_name,
  };
}

// For the admin config screen (M5.1) - every reason, active and inactive alike (an admin managing
// the picklist needs to see and reactivate a retired one, unlike a Mark Won/Lost picker, which
// M5.3 will scope to active-only when it's actually built).
export async function listOutcomeReasons(supabase: SupabaseClient, tenantId: string): Promise<OutcomeReason[]> {
  const { data, error } = await supabase
    .from("outcome_reasons")
    .select(OUTCOME_REASON_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("type")
    .order("sort_order");

  if (error) throw new Error(`listOutcomeReasons failed: ${error.message}`);
  return (data as OutcomeReasonRow[]).map(toDomain);
}

// For closeDeal's (M5.2) own pre-validation - the reason type/tenant/requires-competitor-name
// checks that give a clean CloseDealResult code instead of surfacing close_deal's raw exception
// (migration 0017's own header comment: the RPC repeats these as a non-bypassable backstop, this
// is the friendlier first check). Relies on outcome_reasons_select's RLS being tenant-wide (migration
// 0016) to do the tenant scoping implicitly through the caller's own session, the same way
// getStageById already does for pipeline_stages - a reason belonging to another tenant simply
// isn't visible, so this returns null exactly as it would for a genuinely missing id.
export async function getOutcomeReasonById(supabase: SupabaseClient, id: string): Promise<OutcomeReason | null> {
  const { data, error } = await supabase.from("outcome_reasons").select(OUTCOME_REASON_COLUMNS).eq("id", id).maybeSingle();

  if (error) throw new Error(`getOutcomeReasonById failed: ${error.message}`);
  if (!data) return null;
  return toDomain(data as OutcomeReasonRow);
}

export interface NewOutcomeReasonInput {
  tenantId: string;
  type: OutcomeType;
  label: string;
  sortOrder: number;
  requiresCompetitorName: boolean;
  createdBy: string;
}

export async function insertOutcomeReason(supabase: SupabaseClient, input: NewOutcomeReasonInput): Promise<OutcomeReason> {
  const { data, error } = await supabase
    .from("outcome_reasons")
    .insert({
      tenant_id: input.tenantId,
      type: input.type,
      label: input.label,
      sort_order: input.sortOrder,
      requires_competitor_name: input.requiresCompetitorName,
      created_by: input.createdBy,
    })
    .select(OUTCOME_REASON_COLUMNS)
    .single();

  if (error) throw new Error(`insertOutcomeReason failed: ${error.message}`);
  return toDomain(data as OutcomeReasonRow);
}

// Only ever toggles is_active from this milestone's own UI (M5.1's backlog scope is "admin
// configuration", not a full label/reorder editor) - label/sort_order edits are a real, plausible
// future need, just not one this milestone's UI builds yet.
export async function setOutcomeReasonActive(supabase: SupabaseClient, id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.from("outcome_reasons").update({ is_active: isActive }).eq("id", id);
  if (error) throw new Error(`setOutcomeReasonActive failed: ${error.message}`);
}
