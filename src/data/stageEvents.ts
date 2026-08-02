import type { SupabaseClient } from "@supabase/supabase-js";
import type { StageEvent, StageEventInput } from "@/domain/stageEvent";

interface StageEventsRow {
  id: string;
  tenant_id: string;
  deal_id: string;
  from_stage_id: string | null;
  to_stage_id: string;
  actor_id: string | null;
  occurred_at: string;
  duration_in_previous_seconds: string | null; // bigint over PostgREST: text, same as money columns
  is_reconstructed: boolean;
  is_regression: boolean;
}

function toDomain(row: StageEventsRow): StageEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    dealId: row.deal_id,
    fromStageId: row.from_stage_id,
    toStageId: row.to_stage_id,
    actorId: row.actor_id,
    occurredAt: row.occurred_at,
    durationInPreviousSeconds: row.duration_in_previous_seconds === null ? null : Number(row.duration_in_previous_seconds),
    isReconstructed: row.is_reconstructed,
    isRegression: row.is_regression,
  };
}

// The only place application code inserts into stage_events - called exclusively by
// src/services/stageEvents.ts's writeStageEvent, itself called exclusively by
// src/services/deals.ts's changeStage (docs/03-architecture.md single-path rule: "There must be
// exactly one code path that moves a stage"). Uses the service_role client internally - migration
// 0007 grants `authenticated` no insert policy on stage_events at all, the same immutable-history
// shape as audit_entries.
export async function insertStageEvent(serviceClient: SupabaseClient, input: StageEventInput): Promise<StageEvent> {
  const { data, error } = await serviceClient
    .from("stage_events")
    .insert({
      tenant_id: input.tenantId,
      deal_id: input.dealId,
      from_stage_id: input.fromStageId,
      to_stage_id: input.toStageId,
      actor_id: input.actorId,
    })
    .select(
      "id, tenant_id, deal_id, from_stage_id, to_stage_id, actor_id, occurred_at, " +
        "duration_in_previous_seconds::text, is_reconstructed, is_regression",
    )
    .single();

  if (error) throw new Error(`insertStageEvent failed: ${error.message}`);
  return toDomain(data as unknown as StageEventsRow);
}

// M2.3: "days in current stage" needs, per deal, the occurred_at of its MOST RECENT stage_events
// row (or nothing, for a deal that has never had a stage transition since creation - see
// src/data/deals.ts's fallback to deals.created_at for that case). Reads through the caller's own
// RLS-scoped session, same reasoning as listDeals: stage_events_select (migration 0007) already
// scopes these rows to the caller's tenant/practice entitlement, so no additional narrowing is
// needed here beyond the deal ids the caller already has RLS-scoped access to.
export async function getLatestStageEventOccurredAtByDeal(
  supabase: SupabaseClient,
  dealIds: string[],
): Promise<Map<string, string>> {
  if (dealIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("stage_events")
    .select("deal_id, occurred_at")
    .in("deal_id", dealIds)
    .order("occurred_at", { ascending: false });

  if (error) throw new Error(`getLatestStageEventOccurredAtByDeal failed: ${error.message}`);

  // Descending order means the first row seen per deal_id is its latest - a plain reduce, not a
  // second sort per group.
  const latest = new Map<string, string>();
  for (const row of data as Array<{ deal_id: string; occurred_at: string }>) {
    if (!latest.has(row.deal_id)) latest.set(row.deal_id, row.occurred_at);
  }
  return latest;
}
