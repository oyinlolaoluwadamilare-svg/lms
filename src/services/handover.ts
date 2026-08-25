import type { SupabaseClient } from "@supabase/supabase-js";
import { listActivitiesForDeals, type AccountActivityItem } from "@/data/activities";
import { listDealContactsForDeals } from "@/data/dealContacts";
import { listOpenTasksForDeals, type TaskQueueItem } from "@/data/tasks";
import { listStageEventsForDeals, type AccountStageHistoryEntry } from "@/data/stageEvents";
import type { DecisionRole } from "@/domain/contact";

export type HandoverTimelineEntry = ({ kind: "activity"; dealName: string } & AccountActivityItem) | ({ kind: "stage_change"; dealName: string } & AccountStageHistoryEntry);

export interface HandoverContact {
  contactId: string;
  firstName: string;
  lastName: string | null;
  jobTitle: string | null;
  dealLinks: Array<{ dealId: string; dealName: string; decisionRole: DecisionRole; isPrimary: boolean }>;
}

export interface HandoverSummary {
  recentEngagements: HandoverTimelineEntry[];
  openTasks: TaskQueueItem[];
  contacts: HandoverContact[];
}

// M5.9 (docs/07-build-backlog.md): "Handover panel: last ten engagements, open tasks and contacts,
// shown on owner change." Shared by both owner-change flows this milestone builds -
// src/services/deals.ts's changeDealOwner (a single deal, dealIds always length 1) and
// src/services/accounts.ts's reassignAccountPracticeOwner (every deal the account has in that one
// practice line, since a practice-line relationship handover is about everything that
// relationship covers, not one deal) - both just narrow to a different set of deal ids and call
// this the same way, the same "one function, the caller decides the scope" shape M5.8's
// listActivitiesForDeals/listStageEventsForDeals/listDocumentsForDeals already establish for their
// own account-vs-deal callers.
//
// "Engagements" is the SAME merged activities+stage-events stream docs/06-ui-spec.md already calls
// the "Engagement timeline" (M3.5) and Account 360 (M5.8) already calls "Merged timeline" - not a
// narrower activities-only reading. Capped at 10 after merging and sorting, not 10 of each kind
// separately - "the last ten engagements" names one count for one stream, the same way M5.8's own
// merged timeline has no separate caps per entry kind.
//
// Contacts here are deliberately narrower than Account 360's own Contacts tab: only contacts
// actually LINKED (via deal_contacts) to one of the given deals, not every contact at the account -
// a handover is about who the incoming owner needs to know for THESE specific deals, not the
// account's entire contact book (M5.8's own AccountContactSummary is the right shape for "every
// account contact, cross-referenced with links"; this is "only the linked ones, cross-referenced
// with deals").
export async function getHandoverSummary(supabase: SupabaseClient, dealIds: string[], dealNameById: Map<string, string>): Promise<HandoverSummary> {
  const [activities, stageEvents, openTasks, dealContactsByContact] = await Promise.all([
    listActivitiesForDeals(supabase, dealIds),
    listStageEventsForDeals(supabase, dealIds),
    listOpenTasksForDeals(supabase, dealIds),
    listDealContactsForDeals(supabase, dealIds),
  ]);

  const recentEngagements: HandoverTimelineEntry[] = [
    ...activities.map((a) => ({ kind: "activity" as const, dealName: dealNameById.get(a.dealId) ?? "Unknown deal", ...a })),
    ...stageEvents.map((s) => ({ kind: "stage_change" as const, dealName: dealNameById.get(s.dealId) ?? "Unknown deal", ...s })),
  ]
    .sort((x, y) => {
      const xInstant = x.kind === "activity" ? `${x.activityDate}T12:00:00.000Z` : x.occurredAt;
      const yInstant = y.kind === "activity" ? `${y.activityDate}T12:00:00.000Z` : y.occurredAt;
      return new Date(yInstant).getTime() - new Date(xInstant).getTime();
    })
    .slice(0, 10);

  const contacts: HandoverContact[] = [...dealContactsByContact.entries()].map(([contactId, links]) => ({
    contactId,
    firstName: links[0]!.firstName,
    lastName: links[0]!.lastName,
    jobTitle: links[0]!.jobTitle,
    dealLinks: links.map((link) => ({
      dealId: link.dealId,
      dealName: dealNameById.get(link.dealId) ?? "Unknown deal",
      decisionRole: link.decisionRole,
      isPrimary: link.isPrimary,
    })),
  }));

  return { recentEngagements, openTasks, contacts };
}
