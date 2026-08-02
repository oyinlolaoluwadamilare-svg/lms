import type { SupabaseClient } from "@supabase/supabase-js";
import { listActivitiesForDeal } from "@/data/activities";
import { listActivityRevisionsForActivities, type ActivityRevisionItem } from "@/data/activityRevisions";
import { listStageEventsForDeal } from "@/data/stageEvents";
import type { ActivityType, OutcomeDisposition } from "@/domain/activity";

export interface ActivityTimelineEntry {
  kind: "activity";
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
  revisions: ActivityRevisionItem[];
  sortInstant: string;
}

export interface StageChangeTimelineEntry {
  kind: "stage_change";
  id: string;
  fromStageName: string | null;
  toStageName: string;
  actorId: string | null;
  actorName: string | null;
  occurredAt: string;
  durationInPreviousSeconds: number | null;
  isRegression: boolean;
  isReconstructed: boolean;
  sortInstant: string;
}

export type TimelineEntry = ActivityTimelineEntry | StageChangeTimelineEntry;

export interface TimelineFilters {
  // An activity's own type, or the pseudo-type "stage_change" for a stage transition - the one
  // type of engagement that isn't an activities row at all.
  type?: ActivityType | "stage_change";
  authorId?: string; // matches an activity's author or a stage change's actor - same person concept
}

export interface EngagementTimeline {
  entries: TimelineEntry[];
  // Derived from the FULL, unfiltered set so applying a filter never removes an option from the
  // dropdown that produced it - the same reasoning a filter's own option list should never shrink
  // just because you used it.
  availableAuthors: Array<{ id: string; name: string }>;
}

// M3.5 (docs/07-build-backlog.md): "Engagement timeline component merging activities and stage
// events, newest first." M3.6 added the per-activity edit/retraction fields (editLockedAt,
// retractedAt, retractedByName, retractionReason, revisions) so the rendering layer can show an
// "edited" marker and struck-through retracted entries without a second round trip. Still narrower
// than docs/06-ui-spec.md's full description in one way, because its dependency doesn't exist yet:
// no "attributed contacts" (M5.5). "Type icon" is rendered as a text label, not a graphic - no icon
// system exists in this codebase yet.
//
// Sorting an activity (activity_date, a DATE) against a stage change (occurred_at, a TIMESTAMPTZ)
// needs a common instant: activity_date becomes noon UTC on that date purely as a SORT key, never
// returned or displayed - CLAUDE.md #5's "activity_date and created_at are different things, never
// conflated in any query, export or API response" is about the values a caller can observe, not an
// internal ordering heuristic; each entry below still carries its own real, distinct date/time
// field untouched. Noon (not midnight) keeps a same-day stage change sorted sensibly adjacent to an
// activity dated the same day, regardless of which side of midnight either instant's own timezone
// rendering would put it on.
//
// Reads through the caller's own RLS-scoped session (both underlying getters already do) - there
// is no separate can() check for viewing a timeline, the same as there is none for deal.view or
// stage-history/activity viewing individually.
export async function getEngagementTimeline(supabase: SupabaseClient, dealId: string, filters: TimelineFilters = {}): Promise<EngagementTimeline> {
  const [activities, stageChanges] = await Promise.all([
    listActivitiesForDeal(supabase, dealId),
    listStageEventsForDeal(supabase, dealId),
  ]);

  const revisionsByActivity = await listActivityRevisionsForActivities(
    supabase,
    activities.map((a) => a.id),
  );

  const activityEntries: ActivityTimelineEntry[] = activities.map((a) => ({
    kind: "activity",
    id: a.id,
    type: a.type,
    isClientFacing: a.isClientFacing,
    activityDate: a.activityDate,
    summary: a.summary,
    outcome: a.outcome,
    outcomeDisposition: a.outcomeDisposition,
    authorId: a.authorId,
    authorName: a.authorName,
    editLockedAt: a.editLockedAt,
    retractedAt: a.retractedAt,
    retractedByName: a.retractedByName,
    retractionReason: a.retractionReason,
    revisions: revisionsByActivity.get(a.id) ?? [],
    sortInstant: `${a.activityDate}T12:00:00.000Z`,
  }));

  const stageChangeEntries: StageChangeTimelineEntry[] = stageChanges.map((s) => ({
    kind: "stage_change",
    id: s.id,
    fromStageName: s.fromStageName,
    toStageName: s.toStageName,
    actorId: s.actorId,
    actorName: s.actorName,
    occurredAt: s.occurredAt,
    durationInPreviousSeconds: s.durationInPreviousSeconds,
    isRegression: s.isRegression,
    isReconstructed: s.isReconstructed,
    sortInstant: s.occurredAt,
  }));

  const all: TimelineEntry[] = [...activityEntries, ...stageChangeEntries].sort(
    (x, y) => new Date(y.sortInstant).getTime() - new Date(x.sortInstant).getTime(),
  );

  const authorsById = new Map<string, string>();
  for (const entry of all) {
    const id = entry.kind === "activity" ? entry.authorId : entry.actorId;
    const name = entry.kind === "activity" ? entry.authorName : entry.actorName;
    if (id && name && !authorsById.has(id)) authorsById.set(id, name);
  }
  const availableAuthors = [...authorsById.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const filtered = all.filter((entry) => {
    if (filters.type) {
      const entryType = entry.kind === "activity" ? entry.type : "stage_change";
      if (entryType !== filters.type) return false;
    }
    if (filters.authorId) {
      const entryAuthorId = entry.kind === "activity" ? entry.authorId : entry.actorId;
      if (entryAuthorId !== filters.authorId) return false;
    }
    return true;
  });

  return { entries: filtered, availableAuthors };
}
