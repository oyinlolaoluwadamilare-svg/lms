import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityType, OutcomeDisposition } from "@/domain/activity";

export interface NewActivityInput {
  tenantId: string;
  dealId: string;
  type: ActivityType;
  activityDate: string; // YYYY-MM-DD
  summary: string;
  outcome: string | null;
  outcomeDisposition: OutcomeDisposition | null;
  authorId: string;
}

export interface InsertedActivity {
  id: string;
  activityDate: string;
  isClientFacing: boolean;
}

// The only place application code inserts into activities - called exclusively by
// src/services/activities.ts's logActivity (docs/07-build-backlog.md M3.2: "the single creation
// path"). Deliberately does not set stage_id_at_time: migration 0008's before-insert trigger
// captures it from the deal's current stage authoritatively, the same trigger-is-authoritative
// pattern updated_at/updated_by and duration_in_previous_seconds already established - a caller
// passing a value here would just be overwritten. Reads/writes through the CALLER's own
// RLS-scoped session (activities_insert, migration 0008), not a service-role client - unlike
// audit_entries/stage_events, there IS an insert policy for `authenticated` on this table.
export async function insertActivity(supabase: SupabaseClient, input: NewActivityInput): Promise<InsertedActivity> {
  const { data, error } = await supabase
    .from("activities")
    .insert({
      tenant_id: input.tenantId,
      deal_id: input.dealId,
      type: input.type,
      activity_date: input.activityDate,
      summary: input.summary,
      outcome: input.outcome,
      outcome_disposition: input.outcomeDisposition,
      author_id: input.authorId,
    })
    .select("id, activity_date, is_client_facing")
    .single();

  if (error) throw new Error(`insertActivity failed: ${error.message}`);

  const row = data as unknown as { id: string; activity_date: string; is_client_facing: boolean };
  return { id: row.id, activityDate: row.activity_date, isClientFacing: row.is_client_facing };
}

export interface ActivityListItem {
  id: string;
  type: ActivityType;
  isClientFacing: boolean;
  activityDate: string;
  summary: string;
  outcome: string | null;
  outcomeDisposition: OutcomeDisposition | null;
  authorId: string | null;
  authorName: string | null;
  retractedAt: string | null;
  retractionReason: string | null;
}

interface ActivityListRow {
  id: string;
  type: ActivityType;
  is_client_facing: boolean;
  activity_date: string;
  summary: string;
  outcome: string | null;
  outcome_disposition: OutcomeDisposition | null;
  author_id: string | null;
  retracted_at: string | null;
  retraction_reason: string | null;
  author: { full_name: string } | null;
}

// M3.5 (docs/07-build-backlog.md): "Engagement timeline component merging activities and stage
// events." This is the activities half - src/services/engagementTimeline.ts merges it with
// src/data/stageEvents.ts's listStageEventsForDeal. Newest first by activity_date, matching the
// merged timeline's own ordering. Reads through the caller's own RLS-scoped session, same
// reasoning as listStageEventsForDeal: activities_select (migration 0008) already scopes rows to
// the caller's tenant/practice entitlement - there is no separate can() check for viewing.
export async function listActivitiesForDeal(supabase: SupabaseClient, dealId: string): Promise<ActivityListItem[]> {
  const { data, error } = await supabase
    .from("activities")
    .select(
      "id, type, is_client_facing, activity_date, summary, outcome, outcome_disposition, author_id, " +
        "retracted_at, retraction_reason, author:users!author_id(full_name)",
    )
    .eq("deal_id", dealId)
    .order("activity_date", { ascending: false });

  if (error) throw new Error(`listActivitiesForDeal failed: ${error.message}`);

  return (data as unknown as ActivityListRow[]).map((row) => ({
    id: row.id,
    type: row.type,
    isClientFacing: row.is_client_facing,
    activityDate: row.activity_date,
    summary: row.summary,
    outcome: row.outcome,
    outcomeDisposition: row.outcome_disposition,
    authorId: row.author_id,
    authorName: row.author?.full_name ?? null,
    retractedAt: row.retracted_at,
    retractionReason: row.retraction_reason,
  }));
}
