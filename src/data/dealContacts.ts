import type { SupabaseClient } from "@supabase/supabase-js";
import type { DecisionRole } from "@/domain/contact";

// For linkContactToDeal's own is_primary decision (src/services/contacts.ts) - the first contact
// linked to a deal must be primary (migration 0018's trg_validate_deal_contact enforces this as a
// non-bypassable backstop; this count is what the service uses to pick the friendly default before
// ever reaching that backstop).
export async function countContactsForDeal(supabase: SupabaseClient, dealId: string): Promise<number> {
  const { count, error } = await supabase.from("deal_contacts").select("contact_id", { count: "exact", head: true }).eq("deal_id", dealId);

  if (error) throw new Error(`countContactsForDeal failed: ${error.message}`);
  return count ?? 0;
}

export interface NewDealContactInput {
  dealId: string;
  contactId: string;
  decisionRole: DecisionRole;
  isPrimary: boolean;
  addedBy: string;
}

const POSTGRES_UNIQUE_VIOLATION = "23505";

// Thrown specifically on a (deal_id, contact_id) collision - the same distinguishing-conflict-from-
// every-other-failure shape DealReferenceConflictError already established, so the caller
// (linkContactToDeal) can return a clean "already_linked" result code instead of a raw exception.
export class DealContactAlreadyLinkedError extends Error {
  constructor(dealId: string, contactId: string) {
    super(`contact ${contactId} is already linked to deal ${dealId}`);
    this.name = "DealContactAlreadyLinkedError";
  }
}

// The single path for linking a contact to a deal (docs/03-architecture.md's single-path
// philosophy, the same one changeStage/closeDeal already establish for their own tables) - no
// caller inserts into deal_contacts directly. Deliberately no update/remove counterpart: migration
// 0018's own header comment explains why (no doc names that action yet).
export async function insertDealContact(supabase: SupabaseClient, input: NewDealContactInput): Promise<void> {
  const { error } = await supabase.from("deal_contacts").insert({
    deal_id: input.dealId,
    contact_id: input.contactId,
    decision_role: input.decisionRole,
    is_primary: input.isPrimary,
    added_by: input.addedBy,
  });

  if (error) {
    if ((error as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION) {
      throw new DealContactAlreadyLinkedError(input.dealId, input.contactId);
    }
    throw new Error(`insertDealContact failed: ${error.message}`);
  }
}

export interface DealContactRow {
  contactId: string;
  firstName: string;
  lastName: string | null;
  jobTitle: string | null;
  lastEngagedAt: string | null;
  decisionRole: DecisionRole;
  isPrimary: boolean;
}

interface RawDealContactRow {
  decision_role: DecisionRole;
  is_primary: boolean;
  contacts: { id: string; first_name: string; last_name: string | null; job_title: string | null; last_engaged_at: string | null };
}

// For the deal detail page's Stakeholders section (M5.6) - queries FROM deal_contacts (unlike
// listLossOutcomesForReport's own deals-first convention, src/data/dealOutcomes.ts): here the join
// row's own columns (decision_role, is_primary) are exactly what's being listed, one row per linked
// contact, so there is no base-table-filter reason to query from `contacts` instead. Primary first,
// then alphabetically - the primary contact is the one card a viewer most needs to find quickly.
export async function listDealContactsForDeal(supabase: SupabaseClient, dealId: string): Promise<DealContactRow[]> {
  const { data, error } = await supabase
    .from("deal_contacts")
    .select("decision_role, is_primary, contacts(id, first_name, last_name, job_title, last_engaged_at)")
    .eq("deal_id", dealId);

  if (error) throw new Error(`listDealContactsForDeal failed: ${error.message}`);

  return (data as unknown as RawDealContactRow[])
    .map((row) => ({
      contactId: row.contacts.id,
      firstName: row.contacts.first_name,
      lastName: row.contacts.last_name,
      jobTitle: row.contacts.job_title,
      lastEngagedAt: row.contacts.last_engaged_at,
      decisionRole: row.decision_role,
      isPrimary: row.is_primary,
    }))
    .sort((a, b) => (a.isPrimary === b.isPrimary ? a.firstName.localeCompare(b.firstName) : a.isPrimary ? -1 : 1));
}

export interface AccountDealContactRow extends DealContactRow {
  dealId: string;
}

interface RawAccountDealContactRow extends RawDealContactRow {
  deal_id: string;
}

// For Account 360's Contacts tab (M5.8: "Contacts with decision roles"). A contact can be linked to
// more than one of the account's own deals, potentially with a different decision_role each time
// (deal_contacts' own per-deal shape, M5.5) - so unlike the deal-level version, this is keyed by
// contact_id into a Map of that contact's own links across every deal on the account, not a flat
// list assuming one role per contact. Batched in one call, the same reasoning
// listDealContactsForDeal's sibling batched functions (M5.7's listContactsForActivities) already
// establish for "one related-list fetch, keyed by id."
export async function listDealContactsForDeals(supabase: SupabaseClient, dealIds: string[]): Promise<Map<string, AccountDealContactRow[]>> {
  if (dealIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("deal_contacts")
    .select("deal_id, decision_role, is_primary, contacts(id, first_name, last_name, job_title, last_engaged_at)")
    .in("deal_id", dealIds);

  if (error) throw new Error(`listDealContactsForDeals failed: ${error.message}`);

  const byContact = new Map<string, AccountDealContactRow[]>();
  for (const row of data as unknown as RawAccountDealContactRow[]) {
    const item: AccountDealContactRow = {
      dealId: row.deal_id,
      contactId: row.contacts.id,
      firstName: row.contacts.first_name,
      lastName: row.contacts.last_name,
      jobTitle: row.contacts.job_title,
      lastEngagedAt: row.contacts.last_engaged_at,
      decisionRole: row.decision_role,
      isPrimary: row.is_primary,
    };
    const existing = byContact.get(item.contactId);
    if (existing) existing.push(item);
    else byContact.set(item.contactId, [item]);
  }
  return byContact;
}
