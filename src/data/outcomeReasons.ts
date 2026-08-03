import type { SupabaseClient } from "@supabase/supabase-js";

export type OutcomeType = "win" | "loss";

export interface OutcomeReason {
  id: string;
  type: OutcomeType;
  label: string;
  sortOrder: number;
  isActive: boolean;
}

interface OutcomeReasonRow {
  id: string;
  type: OutcomeType;
  label: string;
  sort_order: number;
  is_active: boolean;
}

function toDomain(row: OutcomeReasonRow): OutcomeReason {
  return { id: row.id, type: row.type, label: row.label, sortOrder: row.sort_order, isActive: row.is_active };
}

// For the admin config screen (M5.1) - every reason, active and inactive alike (an admin managing
// the picklist needs to see and reactivate a retired one, unlike a Mark Won/Lost picker, which
// M5.3 will scope to active-only when it's actually built).
export async function listOutcomeReasons(supabase: SupabaseClient, tenantId: string): Promise<OutcomeReason[]> {
  const { data, error } = await supabase
    .from("outcome_reasons")
    .select("id, type, label, sort_order, is_active")
    .eq("tenant_id", tenantId)
    .order("type")
    .order("sort_order");

  if (error) throw new Error(`listOutcomeReasons failed: ${error.message}`);
  return (data as OutcomeReasonRow[]).map(toDomain);
}

export interface NewOutcomeReasonInput {
  tenantId: string;
  type: OutcomeType;
  label: string;
  sortOrder: number;
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
      created_by: input.createdBy,
    })
    .select("id, type, label, sort_order, is_active")
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
