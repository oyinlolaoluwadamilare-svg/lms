import type { SupabaseClient } from "@supabase/supabase-js";
import { can, type Actor } from "@/auth/permissions";
import {
  listStagesWithBottleneckThreshold,
  updateStageBottleneckThreshold,
  type StageWithBottleneckThreshold,
} from "@/data/pipelineStages";
import { writeAudit } from "@/services/audit";

// Re-exported so app/(app)/admin/pipeline-stages only needs to import from this module - app may
// not import src/data directly (eslint.config.mjs boundaries).
export type { StageWithBottleneckThreshold };

// M6.3 (docs/07-build-backlog.md): "Time in stage with median headline; bottleneck highlighting."
// docs/06-ui-spec.md's own Admin screen already names "Pipeline Stages" as one of eight tabs
// (app/(app)/admin/page.tsx's own comment has listed it as "lands later" since M5.1); this is that
// tab's first real content - deliberately narrow, though: only the bottleneck threshold this
// milestone actually needs is editable here, not the full stage editor that same ui-spec line also
// describes ("the stage editor warns that renaming preserves history while reordering affects
// reporting") - renaming, reordering, creating and deactivating stages are all real, separate
// features nothing in the backlog through M6.3 asks this milestone to build, the same "ship the
// narrower, clearly-named slice" discipline M5.1's own Outcome Reasons admin screen (create +
// activate/deactivate only, no label/reorder editing) already established for a sibling admin
// screen.
//
// migration 0005's pipeline_stages_update RLS policy (tenant_admin-only) has existed since M1.1
// with no real caller and no RLS test of its own until this milestone - both close here rather than
// the gap persisting further. Gated via can() directly, the same "the admin screen is narrower than
// what RLS alone would allow, checked explicitly rather than trusted" reasoning
// src/services/outcomeReasons.ts's own header comment gives.

export type GetStagesForAdminResult = { ok: true; stages: StageWithBottleneckThreshold[] } | { ok: false; code: "denied" };

export async function getStagesForAdmin(supabase: SupabaseClient, actor: Actor): Promise<GetStagesForAdminResult> {
  if (!can(actor, "admin.manage_stages")) return { ok: false, code: "denied" };
  const stages = await listStagesWithBottleneckThreshold(supabase);
  return { ok: true, stages };
}

export type SetStageBottleneckThresholdResult = { ok: true } | { ok: false; code: "denied" };

export async function setStageBottleneckThreshold(
  supabase: SupabaseClient,
  actor: Actor,
  stageId: string,
  thresholdDays: number | null,
): Promise<SetStageBottleneckThresholdResult> {
  if (!can(actor, "admin.manage_stages")) return { ok: false, code: "denied" };

  await updateStageBottleneckThreshold(supabase, stageId, thresholdDays);

  await writeAudit({
    tenantId: actor.tenantId,
    actorId: actor.id,
    entityType: "pipeline_stage",
    entityId: stageId,
    action: "admin.manage_stages",
    after: { bottleneckThresholdDays: thresholdDays },
  });

  return { ok: true };
}
