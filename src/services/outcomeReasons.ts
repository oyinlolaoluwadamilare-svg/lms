import type { SupabaseClient } from "@supabase/supabase-js";
import { can, type Actor } from "@/auth/permissions";
import {
  insertOutcomeReason,
  listOutcomeReasons,
  setOutcomeReasonActive,
  type OutcomeReason,
  type OutcomeType,
} from "@/data/outcomeReasons";
import { writeAudit } from "@/services/audit";

// Re-exported so app/(app)/admin/outcome-reasons only needs to import from this module - app may
// not import src/data directly (eslint.config.mjs boundaries), including for types.
export type { OutcomeReason, OutcomeType };

// M5.1 (docs/07-build-backlog.md): "`outcome_reasons` admin configuration." migration 0016's own
// RLS already scopes outcome_reasons_select tenant-wide (any role can read the picklist - M5.3's
// Mark Won/Lost dialogs will need that), but this ADMIN screen is narrower than what RLS alone
// would allow: only tenant_admin may reach it at all, checked here explicitly via can() rather
// than relying on the route's own checkRouteAccess gate (CLAUDE.md #1 - UI hiding is never the
// sole control, and a service is never "trusted" merely because only one route happens to call it
// today).

export type GetOutcomeReasonsResult = { ok: true; reasons: OutcomeReason[] } | { ok: false; code: "denied" };

export async function getOutcomeReasons(supabase: SupabaseClient, actor: Actor): Promise<GetOutcomeReasonsResult> {
  if (!can(actor, "admin.manage_outcome_reasons")) return { ok: false, code: "denied" };
  const reasons = await listOutcomeReasons(supabase, actor.tenantId);
  return { ok: true, reasons };
}

export type CreateOutcomeReasonResult = { ok: true; reason: OutcomeReason } | { ok: false; code: "denied" };

export async function createOutcomeReason(
  supabase: SupabaseClient,
  actor: Actor,
  input: { type: OutcomeType; label: string; sortOrder: number; requiresCompetitorName?: boolean },
): Promise<CreateOutcomeReasonResult> {
  if (!can(actor, "admin.manage_outcome_reasons")) return { ok: false, code: "denied" };

  // requiresCompetitorName only means anything for a loss reason - migration 0017's own
  // requires_competitor_name_only_for_loss check constraint is the authoritative backstop, this
  // just avoids a doomed insert for a win reason ticked by mistake.
  const requiresCompetitorName = input.type === "loss" && (input.requiresCompetitorName ?? false);

  const reason = await insertOutcomeReason(supabase, {
    tenantId: actor.tenantId,
    type: input.type,
    label: input.label,
    sortOrder: input.sortOrder,
    requiresCompetitorName,
    createdBy: actor.id,
  });

  await writeAudit({
    tenantId: actor.tenantId,
    actorId: actor.id,
    entityType: "outcome_reason",
    entityId: reason.id,
    action: "admin.manage_outcome_reasons",
    after: { type: reason.type, label: reason.label, sortOrder: reason.sortOrder, requiresCompetitorName: reason.requiresCompetitorName },
  });

  return { ok: true, reason };
}

export type SetOutcomeReasonActiveResult = { ok: true } | { ok: false; code: "denied" };

export async function setOutcomeReasonActiveStatus(
  supabase: SupabaseClient,
  actor: Actor,
  id: string,
  isActive: boolean,
): Promise<SetOutcomeReasonActiveResult> {
  if (!can(actor, "admin.manage_outcome_reasons")) return { ok: false, code: "denied" };

  await setOutcomeReasonActive(supabase, id, isActive);

  await writeAudit({
    tenantId: actor.tenantId,
    actorId: actor.id,
    entityType: "outcome_reason",
    entityId: id,
    action: "admin.manage_outcome_reasons",
    after: { isActive },
  });

  return { ok: true };
}
