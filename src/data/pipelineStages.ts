import type { SupabaseClient } from "@supabase/supabase-js";
import type { StageType } from "@/domain/deal";

export interface PipelineStageOption {
  id: string;
  name: string;
  sortOrder: number;
  stageType: StageType;
}

// For a stage picker on the create-deal form. Scoped by RLS (pipeline_stages_select: tenant-wide
// read). Only "open" stages - a deal is never created already won or lost.
export async function listOpenStages(supabase: SupabaseClient): Promise<PipelineStageOption[]> {
  const { data, error } = await supabase
    .from("pipeline_stages")
    .select("id, name, sort_order, stage_type")
    .eq("stage_type", "open")
    .eq("is_active", true)
    .order("sort_order");

  if (error) throw new Error(`listOpenStages failed: ${error.message}`);
  return (data as Array<{ id: string; name: string; sort_order: number; stage_type: StageType }>).map((row) => ({
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    stageType: row.stage_type,
  }));
}

// For the pipeline table's stage filter and column, and the pipeline board's columns - unlike the
// create-deal form, both must cover won/lost stages too: a table/board view needs to show and
// filter by every deal's real stage, not only the ones a deal could be created into.
export async function listAllStages(supabase: SupabaseClient): Promise<PipelineStageOption[]> {
  const { data, error } = await supabase
    .from("pipeline_stages")
    .select("id, name, sort_order, stage_type")
    .eq("is_active", true)
    .order("sort_order");

  if (error) throw new Error(`listAllStages failed: ${error.message}`);
  return (data as Array<{ id: string; name: string; sort_order: number; stage_type: StageType }>).map((row) => ({
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    stageType: row.stage_type,
  }));
}

export interface StageForChangeStage {
  id: string;
  tenantId: string;
  stageType: StageType;
}

// For changeStage (src/services/deals.ts) to validate the target stage before moving a deal into
// it: it must belong to the actor's own tenant (a stage id from another tenant must fail closed,
// not merely rely on RLS's own tenant scoping happening to return zero rows) and must be an "open"
// stage - see isOpenStage's comment in src/domain/deal.ts for why won/lost are refused here.
export async function getStageById(supabase: SupabaseClient, stageId: string): Promise<StageForChangeStage | null> {
  const { data, error } = await supabase
    .from("pipeline_stages")
    .select("id, tenant_id, stage_type")
    .eq("id", stageId)
    .maybeSingle();

  if (error) throw new Error(`getStageById failed: ${error.message}`);
  if (!data) return null;

  const row = data as { id: string; tenant_id: string; stage_type: StageType };
  return { id: row.id, tenantId: row.tenant_id, stageType: row.stage_type };
}
