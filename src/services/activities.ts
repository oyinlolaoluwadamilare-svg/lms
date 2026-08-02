import type { SupabaseClient } from "@supabase/supabase-js";
import { can, type Actor } from "@/auth/permissions";
import { insertActivity, type InsertedActivity } from "@/data/activities";
import { getDealForAuthorization } from "@/data/deals";
import { listDealCoOwnerIds } from "@/data/dealCoOwners";
import { dateInTimezone } from "@/lib/dates";
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
