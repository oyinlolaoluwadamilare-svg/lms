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

export interface StageHistoryEntry {
  id: string;
  fromStageName: string | null;
  toStageName: string;
  actorId: string | null;
  actorName: string | null;
  occurredAt: string;
  durationInPreviousSeconds: number | null;
  isRegression: boolean;
  isReconstructed: boolean;
}

export interface AccountStageHistoryEntry extends StageHistoryEntry {
  dealId: string;
}

interface StageHistoryRow {
  id: string;
  occurred_at: string;
  duration_in_previous_seconds: string | null;
  is_regression: boolean;
  is_reconstructed: boolean;
  actor_id: string | null;
  from_stage: { name: string } | null;
  to_stage: { name: string } | null;
  actor: { full_name: string } | null;
}

// M2.4 (docs/07-build-backlog.md): "Stage-history panel on the deal, showing transitions with
// actor, date and duration." Narrower than docs/06-ui-spec.md's full "Engagement timeline" (which
// merges activities and stage events - M3.5, since activities don't exist yet): this is a
// stage_events-only precursor, the same "build what the current schema can honestly serve" scoping
// src/data/deals.ts's own listDeals comment already applies to "stage regression" as a filter.
// Newest first, matching the eventual merged timeline's own ordering (docs/06-ui-spec.md).
//
// Reads through the caller's own RLS-scoped session, same reasoning as getDealDetail:
// stage_events_select (migration 0007) already scopes rows to the caller's tenant/practice
// entitlement (or tenant-wide for executive/tenant_admin) - there is no separate can() check for
// viewing stage history, the same as there is none for deal.view itself.
export async function listStageEventsForDeal(supabase: SupabaseClient, dealId: string): Promise<StageHistoryEntry[]> {
  const { data, error } = await supabase
    .from("stage_events")
    .select(
      "id, occurred_at, duration_in_previous_seconds::text, is_regression, is_reconstructed, actor_id, " +
        "from_stage:pipeline_stages!from_stage_id(name), to_stage:pipeline_stages!to_stage_id(name), " +
        "actor:users!actor_id(full_name)",
    )
    .eq("deal_id", dealId)
    .order("occurred_at", { ascending: false });

  if (error) throw new Error(`listStageEventsForDeal failed: ${error.message}`);

  return (data as unknown as StageHistoryRow[]).map((row) => {
    if (!row.to_stage) {
      throw new Error(`stage_events row ${row.id} has no resolvable to_stage (to_stage_id is not-null, but the join returned nothing)`);
    }
    return {
      id: row.id,
      fromStageName: row.from_stage?.name ?? null,
      toStageName: row.to_stage.name,
      actorId: row.actor_id,
      actorName: row.actor?.full_name ?? null,
      occurredAt: row.occurred_at,
      durationInPreviousSeconds: row.duration_in_previous_seconds === null ? null : Number(row.duration_in_previous_seconds),
      isRegression: row.is_regression,
      isReconstructed: row.is_reconstructed,
    };
  });
}

interface AccountStageHistoryRow extends StageHistoryRow {
  deal_id: string;
}

// The batched, cross-deal sibling of listStageEventsForDeal, for Account 360's Merged timeline
// (M5.8) - the same reasoning src/data/activities.ts's listActivitiesForDeals gives for its own
// batched sibling: stage_events carries no account_id at all (only deal_id), so an account-level
// view goes through the account's own deal ids, one call covering all of them.
export async function listStageEventsForDeals(supabase: SupabaseClient, dealIds: string[]): Promise<AccountStageHistoryEntry[]> {
  if (dealIds.length === 0) return [];

  const { data, error } = await supabase
    .from("stage_events")
    .select(
      "id, deal_id, occurred_at, duration_in_previous_seconds::text, is_regression, is_reconstructed, actor_id, " +
        "from_stage:pipeline_stages!from_stage_id(name), to_stage:pipeline_stages!to_stage_id(name), " +
        "actor:users!actor_id(full_name)",
    )
    .in("deal_id", dealIds)
    .order("occurred_at", { ascending: false });

  if (error) throw new Error(`listStageEventsForDeals failed: ${error.message}`);

  return (data as unknown as AccountStageHistoryRow[]).map((row) => {
    if (!row.to_stage) {
      throw new Error(`stage_events row ${row.id} has no resolvable to_stage (to_stage_id is not-null, but the join returned nothing)`);
    }
    return {
      id: row.id,
      dealId: row.deal_id,
      fromStageName: row.from_stage?.name ?? null,
      toStageName: row.to_stage.name,
      actorId: row.actor_id,
      actorName: row.actor?.full_name ?? null,
      occurredAt: row.occurred_at,
      durationInPreviousSeconds: row.duration_in_previous_seconds === null ? null : Number(row.duration_in_previous_seconds),
      isRegression: row.is_regression,
      isReconstructed: row.is_reconstructed,
    };
  });
}
