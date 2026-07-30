import type { SupabaseClient } from "@supabase/supabase-js";

export interface PipelineStageOption {
  id: string;
  name: string;
  sortOrder: number;
}

// For a stage picker on the create-deal form. Scoped by RLS (pipeline_stages_select: tenant-wide
// read). Only "open" stages - a deal is never created already won or lost.
export async function listOpenStages(supabase: SupabaseClient): Promise<PipelineStageOption[]> {
  const { data, error } = await supabase
    .from("pipeline_stages")
    .select("id, name, sort_order")
    .eq("stage_type", "open")
    .eq("is_active", true)
    .order("sort_order");

  if (error) throw new Error(`listOpenStages failed: ${error.message}`);
  return (data as Array<{ id: string; name: string; sort_order: number }>).map((row) => ({
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
  }));
}

// For the pipeline table's stage filter and column, which - unlike the create-deal form - must
// cover won/lost stages too: a table view needs to show and filter by every deal's real stage,
// not only the ones a deal could be created into.
export async function listAllStages(supabase: SupabaseClient): Promise<PipelineStageOption[]> {
  const { data, error } = await supabase
    .from("pipeline_stages")
    .select("id, name, sort_order")
    .eq("is_active", true)
    .order("sort_order");

  if (error) throw new Error(`listAllStages failed: ${error.message}`);
  return (data as Array<{ id: string; name: string; sort_order: number }>).map((row) => ({
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
  }));
}
