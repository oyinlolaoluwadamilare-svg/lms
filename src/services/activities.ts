import type { SupabaseClient } from "@supabase/supabase-js";
import { can, type Actor } from "@/auth/permissions";
import { applyActivityEdit, getActivityForAuthorization, insertActivity, retractActivityRow, type InsertedActivity } from "@/data/activities";
import { insertActivityRevisions, type FieldChange } from "@/data/activityRevisions";
import { getDealForAuthorization } from "@/data/deals";
import { listDealCoOwnerIds } from "@/data/dealCoOwners";
import { dateInTimezone } from "@/lib/dates";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAudit } from "@/services/audit";
import type { ActivityType, OutcomeDisposition } from "@/domain/activity";

export interface LogActivityInput {
  dealId: string;
  type: ActivityType;
  activityDate: string; // YYYY-MM-DD
  summary: string;
  outcome: string | null;
  outcomeDisposition: OutcomeDisposition | null;
}

export type LogActivityResult =
  | { ok: true; activity: InsertedActivity }
  | { ok: false; code: "not_found" | "denied" | "activity_date_in_future" };

// The single path for logging an activity (docs/07-build-backlog.md M3.2). Mirrors changeStage's
// shape exactly (src/services/deals.ts): not_found before denied (RLS already hid the row from an
// actor outside their scope, so this never confirms existence to them - same reasoning as
// changeStage's own not_found case), can() checked here even though activities_insert (migration
// 0008) enforces the same scope independently (CLAUDE.md #1: RLS is a second, independent control).
//
// `timezone` is the caller's own resolved timezone (src/services/actor.ts) - migration 0008's
// activity_date_not_future check constraint is only a coarse UTC backstop (its own comment
// explains why), so this is where the PRECISE, timezone-aware future-date rejection actually
// happens, using the same src/lib/dates.ts infrastructure M2.3/M2.4 already built.
//
// Known gap, same one createDeal/changeStage's own comments already flag for every compound write
// in this Supabase-client architecture: the activity insert (which itself fires migration 0009's
// trg_activity_refresh trigger, updating the deal's last_engaged_at/engagement_count) and the
// audit write below are two separate calls, not one transaction - if the audit write throws, the
// activity (and its already-triggered deal update) exist, un-audited.
export async function logActivity(
  supabase: SupabaseClient,
  actor: Actor,
  timezone: string,
  input: LogActivityInput,
  now: Date = new Date(),
): Promise<LogActivityResult> {
  const deal = await getDealForAuthorization(supabase, input.dealId);
  if (!deal) return { ok: false, code: "not_found" };

  const coOwnerIds = await listDealCoOwnerIds(supabase, input.dealId);
  const resource = {
    tenantId: deal.tenantId,
    practiceLineId: deal.practiceLineId,
    ownerId: deal.ownerId ?? undefined,
    authorId: deal.authorId,
    coOwnerIds,
  };
  if (!can(actor, "activity.create", resource)) {
    return { ok: false, code: "denied" };
  }

  const today = dateInTimezone(now.toISOString(), timezone);
  if (input.activityDate > today) {
    return { ok: false, code: "activity_date_in_future" };
  }

  const activity = await insertActivity(supabase, {
    tenantId: actor.tenantId,
    dealId: input.dealId,
    type: input.type,
    activityDate: input.activityDate,
    summary: input.summary,
    outcome: input.outcome,
    outcomeDisposition: input.outcomeDisposition,
    authorId: actor.id,
  });

  await writeAudit({
    tenantId: actor.tenantId,
    actorId: actor.id,
    entityType: "activity",
    entityId: activity.id,
    action: "activity.create",
    after: { dealId: input.dealId, type: input.type, activityDate: input.activityDate },
  });

  return { ok: true, activity };
}

// For the deal detail page to decide whether to show the "Log Activity" button at all
// (docs/06-ui-spec.md: "visible to every writing role including BDE" - not executive). Mirrors
// getDealForEditView's shape (src/services/deals.ts): a separate fetch from getDealDetail, since
// that function's shape is display-oriented (owner/author/co-owner NAMES, not ids) and can't build
// a can() Resource on its own. Returns false for a deal that doesn't exist or isn't visible to this
// actor, the same not-distinguishing-not_found-from-denied a hidden button doesn't need to explain.
export async function canLogActivity(supabase: SupabaseClient, actor: Actor, dealId: string): Promise<boolean> {
  const deal = await getDealForAuthorization(supabase, dealId);
  if (!deal) return false;

  const coOwnerIds = await listDealCoOwnerIds(supabase, dealId);
  return can(actor, "activity.create", {
    tenantId: deal.tenantId,
    practiceLineId: deal.practiceLineId,
    ownerId: deal.ownerId ?? undefined,
    authorId: deal.authorId,
    coOwnerIds,
  });
}

// For the Engagement timeline to decide whether to offer a Retract control at all (M3.6), computed
// once per deal rather than per-entry: unlike activity.update (author-only, so it varies per
// activity), activity.retract's eligibility (docs/02-permission-matrix.md) depends only on the
// actor's role and the deal's practice/tenant, identical for every activity on this deal. Mirrors
// canLogActivity's shape - returns false for a deal that doesn't exist or isn't visible, the same
// not-distinguishing-not_found-from-denied a hidden button doesn't need to explain.
export async function canRetractActivity(supabase: SupabaseClient, actor: Actor, dealId: string): Promise<boolean> {
  const deal = await getDealForAuthorization(supabase, dealId);
  if (!deal) return false;

  return can(actor, "activity.retract", { tenantId: deal.tenantId, practiceLineId: deal.practiceLineId });
}

export interface UpdateActivityInput {
  type: ActivityType;
  activityDate: string; // YYYY-MM-DD
  summary: string;
  outcome: string | null;
  outcomeDisposition: OutcomeDisposition | null;
}

export type UpdateActivityResult =
  | { ok: true }
  | { ok: false; code: "not_found" | "denied" | "retracted" | "edit_window_expired" };

// The single path for editing an activity (docs/07-build-backlog.md M3.6: "Edit within the
// 24-hour window with revision history and an 'edited' marker"). docs/02-permission-matrix.md's
// activity.update is uniformly "own" for every role, including tenant_admin - authorId is the only
// thing can() checks here, unlike activity.create's deal-ownership shape. Mirrors updateDeal's own
// field-diff-then-audit shape (src/services/deals.ts), but ALSO writes one activity_revisions row
// per changed field (not just one combined audit before/after) - that per-field ledger is the
// whole reason this table exists, distinct from (and written alongside) the audit trail.
//
// `edit_window_expired` is checked here explicitly, with the actor's real "now" against the
// activity's own edit_locked_at (an absolute instant - no timezone resolution needed, unlike
// activity_date), rather than just letting a stale-window UPDATE silently affect zero rows via
// activities_update's RLS policy: a caller needs to know WHY nothing happened, the same reasoning
// logActivity's activity_date_in_future is a distinct code rather than a generic denial.
export async function updateActivity(
  supabase: SupabaseClient,
  actor: Actor,
  activityId: string,
  input: UpdateActivityInput,
  now: Date = new Date(),
): Promise<UpdateActivityResult> {
  const activity = await getActivityForAuthorization(supabase, activityId);
  if (!activity) return { ok: false, code: "not_found" };

  if (!can(actor, "activity.update", { tenantId: activity.tenantId, authorId: activity.authorId ?? undefined })) {
    return { ok: false, code: "denied" };
  }

  if (activity.retractedAt) return { ok: false, code: "retracted" };
  if (now.getTime() >= new Date(activity.editLockedAt).getTime()) return { ok: false, code: "edit_window_expired" };

  const changes: FieldChange[] = [];
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const noteChange = (field: string, previous: string | null, next: string | null) => {
    if (previous === next) return;
    changes.push({ fieldName: field, previousValue: previous, newValue: next });
    before[field] = previous;
    after[field] = next;
  };

  noteChange("type", activity.type, input.type);
  noteChange("activityDate", activity.activityDate, input.activityDate);
  noteChange("summary", activity.summary, input.summary);
  noteChange("outcome", activity.outcome, input.outcome);
  noteChange("outcomeDisposition", activity.outcomeDisposition, input.outcomeDisposition);

  if (changes.length === 0) return { ok: true };

  await applyActivityEdit(supabase, activityId, input);
  await insertActivityRevisions(createServiceClient(), activityId, changes, actor.id);
  await writeAudit({
    tenantId: actor.tenantId,
    actorId: actor.id,
    entityType: "activity",
    entityId: activityId,
    action: "activity.update",
    before,
    after,
  });

  return { ok: true };
}

export type RetractActivityResult =
  | { ok: true }
  | { ok: false; code: "not_found" | "denied" | "already_retracted" | "reason_required" };

// The single path for retracting an activity (docs/07-build-backlog.md M3.6: "retraction by
// Director or Admin with a mandatory reason"). Scoped by the underlying DEAL's practice/tenant
// (docs/02-permission-matrix.md's activity.retract row), not by authorship - a director can retract
// ANY practice member's activity, which is the whole point of retraction as a correction mechanism
// distinct from the author's own 24h edit window. Uses a service-role client for the actual write:
// migration 0008's activities_update RLS policy is author-only within the window, and its own
// comment already named this exact gap as M3.6's job to close with a service-role write, the same
// shape changeStage/writeAudit already use for privileged single-path writes - not an extension of
// that policy.
export async function retractActivity(
  supabase: SupabaseClient,
  actor: Actor,
  activityId: string,
  reason: string,
): Promise<RetractActivityResult> {
  const activity = await getActivityForAuthorization(supabase, activityId);
  if (!activity || !activity.dealId) return { ok: false, code: "not_found" };

  const deal = await getDealForAuthorization(supabase, activity.dealId);
  if (!deal) return { ok: false, code: "not_found" };

  if (!can(actor, "activity.retract", { tenantId: deal.tenantId, practiceLineId: deal.practiceLineId })) {
    return { ok: false, code: "denied" };
  }

  if (activity.retractedAt) return { ok: false, code: "already_retracted" };

  const trimmedReason = reason.trim();
  if (trimmedReason.length === 0) return { ok: false, code: "reason_required" };

  await retractActivityRow(createServiceClient(), activityId, actor.id, trimmedReason);

  await writeAudit({
    tenantId: actor.tenantId,
    actorId: actor.id,
    entityType: "activity",
    entityId: activityId,
    action: "activity.retract",
    before: { retractedAt: null },
    after: { retractedAt: new Date().toISOString(), retractionReason: trimmedReason },
  });

  return { ok: true };
}
