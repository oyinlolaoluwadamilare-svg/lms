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
  editLockedAt: string;
  retractedAt: string | null;
  retractedByName: string | null;
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
  edit_locked_at: string;
  retracted_at: string | null;
  retraction_reason: string | null;
  author: { full_name: string } | null;
  retracted_by_user: { full_name: string } | null;
}

// M3.5 (docs/07-build-backlog.md): "Engagement timeline component merging activities and stage
// events." This is the activities half - src/services/engagementTimeline.ts merges it with
// src/data/stageEvents.ts's listStageEventsForDeal. Newest first by activity_date, matching the
// merged timeline's own ordering. Reads through the caller's own RLS-scoped session, same
// reasoning as listStageEventsForDeal: activities_select (migration 0008) already scopes rows to
// the caller's tenant/practice entitlement - there is no separate can() check for viewing.
// edit_locked_at/retracted_at etc. are included so the timeline (M3.6) can decide per-entry whether
// to offer Edit, without a second round trip.
export async function listActivitiesForDeal(supabase: SupabaseClient, dealId: string): Promise<ActivityListItem[]> {
  const { data, error } = await supabase
    .from("activities")
    .select(
      "id, type, is_client_facing, activity_date, summary, outcome, outcome_disposition, author_id, edit_locked_at, " +
        "retracted_at, retraction_reason, author:users!author_id(full_name), retracted_by_user:users!retracted_by(full_name)",
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
    editLockedAt: row.edit_locked_at,
    retractedAt: row.retracted_at,
    retractedByName: row.retracted_by_user?.full_name ?? null,
    retractionReason: row.retraction_reason,
  }));
}

export interface ActivityForAuthorization {
  id: string;
  tenantId: string;
  dealId: string | null;
  authorId: string | null;
  editLockedAt: string;
  retractedAt: string | null;
  type: ActivityType;
  activityDate: string;
  summary: string;
  outcome: string | null;
  outcomeDisposition: OutcomeDisposition | null;
}

interface ActivityForAuthorizationRow {
  id: string;
  tenant_id: string;
  deal_id: string | null;
  author_id: string | null;
  edit_locked_at: string;
  retracted_at: string | null;
  type: ActivityType;
  activity_date: string;
  summary: string;
  outcome: string | null;
  outcome_disposition: OutcomeDisposition | null;
}

// For updateActivity's and retractActivity's authorisation checks and (for updateActivity) field
// diffing (src/services/activities.ts) - the same "one getter, several callers with an identical
// need" reasoning src/data/deals.ts's getDealForAuthorization already established. Reads through
// the caller's own RLS-scoped session (activities_select, migration 0008) - null means either the
// activity doesn't exist or this actor can't see it, the same not-confirming-existence reasoning
// every other not_found case in this codebase already uses.
export async function getActivityForAuthorization(supabase: SupabaseClient, activityId: string): Promise<ActivityForAuthorization | null> {
  const { data, error } = await supabase
    .from("activities")
    .select("id, tenant_id, deal_id, author_id, edit_locked_at, retracted_at, type, activity_date, summary, outcome, outcome_disposition")
    .eq("id", activityId)
    .maybeSingle();

  if (error) throw new Error(`getActivityForAuthorization failed: ${error.message}`);
  if (!data) return null;

  const row = data as unknown as ActivityForAuthorizationRow;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    dealId: row.deal_id,
    authorId: row.author_id,
    editLockedAt: row.edit_locked_at,
    retractedAt: row.retracted_at,
    type: row.type,
    activityDate: row.activity_date,
    summary: row.summary,
    outcome: row.outcome,
    outcomeDisposition: row.outcome_disposition,
  };
}

export interface ActivityEditFields {
  type: ActivityType;
  activityDate: string;
  summary: string;
  outcome: string | null;
  outcomeDisposition: OutcomeDisposition | null;
}

// The only place these fields are written from application code - called exclusively by
// src/services/activities.ts's updateActivity. Reads/writes through the CALLER's own RLS-scoped
// session (activities_update, migration 0008: author_id = auth.uid() and now() < edit_locked_at) -
// a caller outside that window or authorship simply updates zero rows, which updateActivity
// distinguishes explicitly rather than treating as success.
export async function applyActivityEdit(supabase: SupabaseClient, activityId: string, fields: ActivityEditFields): Promise<void> {
  const { error } = await supabase
    .from("activities")
    .update({
      type: fields.type,
      activity_date: fields.activityDate,
      summary: fields.summary,
      outcome: fields.outcome,
      outcome_disposition: fields.outcomeDisposition,
    })
    .eq("id", activityId);

  if (error) throw new Error(`applyActivityEdit failed: ${error.message}`);
}

// Retraction (docs/02-permission-matrix.md: activity.retract is director/tenant_admin only,
// practice/tenant scoped by the underlying DEAL - not "own author" like activities_update) cannot
// go through the caller's own RLS-scoped session: activities_update's policy is author-only within
// the 24h window, and migration 0008's own comment already flagged this gap as M3.6's job to close
// with "a service-role client, the same shape changeStage/writeAudit already use for privileged
// single-path writes" - this is that write. can() (checked in the service, before this is ever
// called) is the only guardrail on who may call it; the service-role client bypasses RLS entirely
// for this one column set, the same way writeAudit/writeStageEvent already do for their own tables.
export async function retractActivityRow(
  serviceClient: SupabaseClient,
  activityId: string,
  retractedBy: string,
  reason: string,
): Promise<void> {
  const { error } = await serviceClient
    .from("activities")
    .update({ retracted_at: new Date().toISOString(), retracted_by: retractedBy, retraction_reason: reason })
    .eq("id", activityId);

  if (error) throw new Error(`retractActivityRow failed: ${error.message}`);
}
