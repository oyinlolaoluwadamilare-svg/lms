import type { SupabaseClient } from "@supabase/supabase-js";

export interface FieldChange {
  fieldName: string;
  previousValue: string | null;
  newValue: string | null;
}

// The only place application code inserts into activity_revisions - called exclusively by
// src/services/activities.ts's updateActivity, itself the single edit path (docs/07-build-backlog.md
// M3.6). Uses the service_role client internally - migration 0008 grants `authenticated` no insert
// policy on activity_revisions at all, the same immutable-ledger shape as audit_entries/stage_events.
// One row per changed field, not one combined blob - that is the whole point of this table over
// audit_entries' own single before/after JSON row, which updateActivity also still writes
// (CLAUDE.md #6: every state change writes an audit row, no exceptions - the two serve different
// purposes, a compliance trail versus a user-facing "what changed" history, and both are written).
export async function insertActivityRevisions(
  serviceClient: SupabaseClient,
  activityId: string,
  changes: FieldChange[],
  changedBy: string,
): Promise<void> {
  if (changes.length === 0) return;

  const { error } = await serviceClient.from("activity_revisions").insert(
    changes.map((c) => ({
      activity_id: activityId,
      field_name: c.fieldName,
      previous_value: c.previousValue,
      new_value: c.newValue,
      changed_by: changedBy,
    })),
  );

  if (error) throw new Error(`insertActivityRevisions failed: ${error.message}`);
}

export interface ActivityRevisionItem {
  id: string;
  activityId: string;
  fieldName: string;
  previousValue: string | null;
  newValue: string | null;
  changedByName: string | null;
  changedAt: string;
}

interface ActivityRevisionRow {
  id: string;
  activity_id: string;
  field_name: string;
  previous_value: string | null;
  new_value: string | null;
  changed_at: string;
  changed_by_user: { full_name: string } | null;
}

// For the Engagement timeline's "edited marker with revision history" (M3.6) - batched across every
// activity in the deal's timeline in one call, the same reasoning
// src/data/stageEvents.ts's getLatestStageEventOccurredAtByDeal batches across deal ids rather than
// querying per-row. Reads through the caller's own RLS-scoped session
// (activity_revisions_select, migration 0008, scoped like its parent activity) - an activity this
// actor cannot see contributes no revisions here either, not an error.
export async function listActivityRevisionsForActivities(
  supabase: SupabaseClient,
  activityIds: string[],
): Promise<Map<string, ActivityRevisionItem[]>> {
  if (activityIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("activity_revisions")
    .select("id, activity_id, field_name, previous_value, new_value, changed_at, changed_by_user:users!changed_by(full_name)")
    .in("activity_id", activityIds)
    .order("changed_at", { ascending: true });

  if (error) throw new Error(`listActivityRevisionsForActivities failed: ${error.message}`);

  const byActivity = new Map<string, ActivityRevisionItem[]>();
  for (const row of data as unknown as ActivityRevisionRow[]) {
    const item: ActivityRevisionItem = {
      id: row.id,
      activityId: row.activity_id,
      fieldName: row.field_name,
      previousValue: row.previous_value,
      newValue: row.new_value,
      changedByName: row.changed_by_user?.full_name ?? null,
      changedAt: row.changed_at,
    };
    const existing = byActivity.get(row.activity_id);
    if (existing) existing.push(item);
    else byActivity.set(row.activity_id, [item]);
  }
  return byActivity;
}
