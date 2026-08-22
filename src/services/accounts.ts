import type { SupabaseClient } from "@supabase/supabase-js";
import { can, type Action, type Actor } from "@/auth/permissions";
import {
  getAccountDetail,
  listAccountsForDirectory as dataListAccountsForDirectory,
  listPracticeLineIdsForAccount,
  listPracticeLineOwnersForAccount,
  type AccountListItem,
  type AccountPracticeOwner,
} from "@/data/accounts";
// Re-exported so app/(app) only needs to import from this module - app may not import src/data
// directly (eslint.config.mjs boundaries), including for types.
export type { AccountListItem };
import { listActivitiesForDeals, type AccountActivityItem } from "@/data/activities";
import { listActiveContactsForAccount } from "@/data/contacts";
import { listDealContactsForDeals, type AccountDealContactRow } from "@/data/dealContacts";
import { listWonOutcomesForAccount } from "@/data/dealOutcomes";
import { listDeals, type DealListRow } from "@/data/deals";
import { listDocumentsForDeals, type AccountDocumentItem } from "@/data/documents";
import { listStageEventsForDeals, type AccountStageHistoryEntry } from "@/data/stageEvents";
import { sumMoneyByCurrency, type Money } from "@/domain/money";

// M5.5 (docs/07-build-backlog.md): "`contacts`, `deal_contacts` migrations; primary-contact
// invariant." Hoisted out of src/services/contacts.ts (M5.8) so both that module and this one share
// one copy - an account can be entitled to MORE than one practice line (account_practice_owners is
// many-to-many, migration 0005's own "practice lines that sell into the same client" reasoning), so
// a single-practiceLineId can()-Resource can't express the check the way a deal's own single
// practice_line_id can. This checks every practice line the account is entitled to, plus the
// tenant-wide case (a resource with no practiceLineId only ever satisfies a "tenant" token, never
// "practice" - see src/auth/permissions.ts's own tokenMatches), mirroring
// account_has_entitled_practice()'s own set-membership reasoning at the RLS layer.
export async function actorEntitledToAccount(supabase: SupabaseClient, actor: Actor, action: Action, accountId: string): Promise<boolean> {
  if (can(actor, action, { tenantId: actor.tenantId })) return true;
  const practiceLineIds = await listPracticeLineIdsForAccount(supabase, accountId);
  return practiceLineIds.some((practiceLineId) => can(actor, action, { tenantId: actor.tenantId, practiceLineId }));
}

// For the Accounts list page (M5.8) - a thin pass-through, the same "no extra logic, RLS already
// scopes it" shape src/data/accounts.ts's own listAccounts already has for the create-deal picker.
// Named for its own caller, not reused from that narrower (id, name)-only picker function - a
// richer, differently-shaped list for a different purpose, not the same list twice.
export async function listAccountsForDirectory(supabase: SupabaseClient): Promise<AccountListItem[]> {
  return dataListAccountsForDirectory(supabase);
}

export interface AccountTiles {
  openPipelineValue: Money[];
  wonRevenue: Money[];
  activeDealsCount: number;
  lastEngagedAt: string | null;
}

export interface AccountContactSummary {
  contactId: string;
  firstName: string;
  lastName: string | null;
  jobTitle: string | null;
  lastEngagedAt: string | null;
  dealLinks: Array<{ dealId: string; dealName: string; decisionRole: AccountDealContactRow["decisionRole"]; isPrimary: boolean }>;
}

export type AccountTimelineEntry =
  | ({ kind: "activity"; dealName: string } & AccountActivityItem)
  | ({ kind: "stage_change"; dealName: string } & AccountStageHistoryEntry);

export interface Account360 {
  id: string;
  name: string;
  industry: string | null;
  region: string | null;
  parentAccountName: string | null;
  practiceLineOwners: AccountPracticeOwner[];
  tiles: AccountTiles;
  deals: DealListRow[];
  contacts: AccountContactSummary[];
  timeline: AccountTimelineEntry[];
  documents: AccountDocumentItem[];
}

// M5.8 (docs/07-build-backlog.md): "Account 360 screen, showing each practice-line relationship
// with its own owner (D-03)." docs/06-ui-spec.md's own three-sentence spec: "Header with account,
// industry, region, parent group, owner. Tiles: open pipeline, won revenue, active deals, last
// engagement across the account. Tabs: Deals (across practice lines, respecting entitlement),
// Contacts with decision roles, Merged timeline, Documents."
//
// Read-only, deliberately: the backlog line says "showing," and neither this ui-spec section nor
// docs/02-permission-matrix.md names any action for reassigning a practice-line owner - the same
// "ship the narrower, clearly-named slice" discipline D-14 already applied to deal_contacts.
// Reassignment, if a future milestone needs it, would ride on `account.update` (migration 0005's
// own `account_practice_owners_update` comment: "reassignment is an update to owner_id, not a
// delete+insert") - not a new permission action, but still new UI this milestone doesn't build.
//
// No separate can() check here beyond RLS: reads through the CALLER's own RLS-scoped session
// throughout, the same "no separate can() check for viewing" convention getDealDetail/
// getEngagementTimeline already establish - accounts_select (migration 0005) is the only
// authorisation boundary for the header/tiles, and every tab's own table (deals_select,
// account_practice_owners_select, contacts_select, deal_contacts_select, activities_select,
// stage_events_select, documents_select) independently scopes its own rows to the caller's own
// practice entitlement - "respecting entitlement" (the Deals tab's own words) falls out of that for
// free, not from any extra filtering this function does itself.
//
// "Deals across practice lines" is literally `listDeals(supabase, { accountId })` - no new deals
// query needed, RLS already narrows it correctly. The Merged timeline and Documents tabs both go
// through the account's own deal ids rather than `activities.account_id`/`documents.account_id`
// directly - see listActivitiesForDeals/listDocumentsForDeals's own comments for why those columns
// exist but are never populated by any code path in this codebase.
export async function getAccount360(supabase: SupabaseClient, accountId: string, timezone: string): Promise<Account360 | null> {
  const account = await getAccountDetail(supabase, accountId);
  if (!account) return null;

  const [practiceLineOwners, deals, wonOutcomes, activeContacts] = await Promise.all([
    listPracticeLineOwnersForAccount(supabase, accountId),
    listDeals(supabase, { accountId }, timezone),
    listWonOutcomesForAccount(supabase, accountId),
    listActiveContactsForAccount(supabase, accountId),
  ]);

  const dealIds = deals.map((d) => d.id);
  const dealNameById = new Map(deals.map((d) => [d.id, d.name]));

  const [activities, stageEvents, dealContactsByContact, documents] = await Promise.all([
    listActivitiesForDeals(supabase, dealIds),
    listStageEventsForDeals(supabase, dealIds),
    listDealContactsForDeals(supabase, dealIds),
    listDocumentsForDeals(supabase, dealIds),
  ]);

  const activeDeals = deals.filter((d) => d.status === "active");
  const tiles: AccountTiles = {
    openPipelineValue: sumMoneyByCurrency(activeDeals.map((d) => d.value)),
    wonRevenue: sumMoneyByCurrency(wonOutcomes),
    activeDealsCount: activeDeals.length,
    lastEngagedAt: deals.reduce<string | null>((latest, d) => {
      if (!d.lastEngagedAt) return latest;
      return !latest || d.lastEngagedAt > latest ? d.lastEngagedAt : latest;
    }, null),
  };

  const contacts: AccountContactSummary[] = activeContacts.map((contact) => ({
    contactId: contact.id,
    firstName: contact.firstName,
    lastName: contact.lastName,
    jobTitle: contact.jobTitle,
    lastEngagedAt: contact.lastEngagedAt,
    dealLinks: (dealContactsByContact.get(contact.id) ?? []).map((link) => ({
      dealId: link.dealId,
      dealName: dealNameById.get(link.dealId) ?? "Unknown deal",
      decisionRole: link.decisionRole,
      isPrimary: link.isPrimary,
    })),
  }));

  // Sorting an activity (activity_date, a DATE) against a stage change (occurred_at, a TIMESTAMPTZ)
  // needs a common instant - the exact same noon-UTC sort-key-only technique
  // src/services/engagementTimeline.ts's own comment explains and justifies; nothing here is ever
  // returned or displayed from that synthetic instant, each entry keeps its own real field.
  const timeline: AccountTimelineEntry[] = [
    ...activities.map((a) => ({ kind: "activity" as const, dealName: dealNameById.get(a.dealId) ?? "Unknown deal", ...a })),
    ...stageEvents.map((s) => ({ kind: "stage_change" as const, dealName: dealNameById.get(s.dealId) ?? "Unknown deal", ...s })),
  ].sort((x, y) => {
    const xInstant = x.kind === "activity" ? `${x.activityDate}T12:00:00.000Z` : x.occurredAt;
    const yInstant = y.kind === "activity" ? `${y.activityDate}T12:00:00.000Z` : y.occurredAt;
    return new Date(yInstant).getTime() - new Date(xInstant).getTime();
  });

  return {
    id: account.id,
    name: account.name,
    industry: account.industry,
    region: account.region,
    parentAccountName: account.parentAccountName,
    practiceLineOwners,
    tiles,
    deals,
    contacts,
    timeline,
    documents,
  };
}
