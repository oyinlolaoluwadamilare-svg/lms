import type { SupabaseClient } from "@supabase/supabase-js";
import { can, type Actor } from "@/auth/permissions";
import { getContactForAuthorization, insertContact, listActiveContactsForAccount, type Contact } from "@/data/contacts";
import { countContactsForDeal, DealContactAlreadyLinkedError, insertDealContact, listDealContactsForDeal, type DealContactRow } from "@/data/dealContacts";
// Re-exported so app/(app) only needs to import from this module - app may not import src/data
// directly (eslint.config.mjs boundaries), including for types.
export type { Contact, DealContactRow };
import { listDealCoOwnerIds } from "@/data/dealCoOwners";
import { getDealForAuthorization } from "@/data/deals";
import { listOpenStages } from "@/data/pipelineStages";
// Hoisted to src/services/accounts.ts (M5.8) so both modules share one copy - see that module's
// own comment for the full reasoning (an account can be entitled to more than one practice line).
import { actorEntitledToAccount } from "@/services/accounts";
import { writeAudit } from "@/services/audit";
import { showsSingleThreadingWarning } from "@/domain/deal";
import type { DecisionRole } from "@/domain/contact";

export interface CreateContactInput {
  accountId: string;
  firstName: string;
  lastName: string | null;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
}

export type CreateContactResult = { ok: true; contact: Contact } | { ok: false; code: "denied" };

export async function createContact(supabase: SupabaseClient, actor: Actor, input: CreateContactInput): Promise<CreateContactResult> {
  const allowed = await actorEntitledToAccount(supabase, actor, "contact.create", input.accountId);
  if (!allowed) return { ok: false, code: "denied" };

  const contact = await insertContact(supabase, {
    tenantId: actor.tenantId,
    accountId: input.accountId,
    firstName: input.firstName,
    lastName: input.lastName,
    jobTitle: input.jobTitle,
    email: input.email,
    phone: input.phone,
    linkedinUrl: input.linkedinUrl,
    createdBy: actor.id,
  });

  await writeAudit({
    tenantId: actor.tenantId,
    actorId: actor.id,
    entityType: "contact",
    entityId: contact.id,
    action: "contact.create",
    after: { accountId: input.accountId, firstName: input.firstName, lastName: input.lastName },
  });

  return { ok: true, contact };
}

export interface LinkContactToDealInput {
  contactId: string;
  decisionRole?: DecisionRole;
}

export type LinkContactToDealResult =
  | { ok: true; isPrimary: boolean }
  | { ok: false; code: "not_found" | "denied" | "contact_wrong_account" | "already_linked" };

// The single path for linking a contact to a deal (docs/03-architecture.md's single-path
// philosophy, the same one changeStage/closeDeal already establish). isPrimary is never a caller
// input, the same "this function decides, not the caller" shape createDeal's own authorId already
// establishes: true for a deal's first contact, false otherwise - migration 0018's own
// trg_validate_deal_contact trigger is the non-bypassable backstop behind this default, not a
// substitute for deciding it correctly here. contact_wrong_account is this function's own
// pre-check of the same rule that trigger enforces, for a clean result code instead of a raw
// exception - the same "TS friendly check, DB non-bypassable backstop" split every compound write
// since M5.2 already uses.
export async function linkContactToDeal(
  supabase: SupabaseClient,
  actor: Actor,
  dealId: string,
  input: LinkContactToDealInput,
): Promise<LinkContactToDealResult> {
  const deal = await getDealForAuthorization(supabase, dealId);
  if (!deal) return { ok: false, code: "not_found" };

  const coOwnerIds = await listDealCoOwnerIds(supabase, dealId);
  const resource = {
    tenantId: deal.tenantId,
    practiceLineId: deal.practiceLineId,
    ownerId: deal.ownerId ?? undefined,
    authorId: deal.authorId,
    coOwnerIds,
  };
  if (!can(actor, "contact.link_to_deal", resource)) {
    return { ok: false, code: "denied" };
  }

  const contact = await getContactForAuthorization(supabase, input.contactId);
  if (!contact) return { ok: false, code: "not_found" };
  if (contact.accountId !== deal.accountId) return { ok: false, code: "contact_wrong_account" };

  const existingCount = await countContactsForDeal(supabase, dealId);
  const isPrimary = existingCount === 0;

  try {
    await insertDealContact(supabase, {
      dealId,
      contactId: input.contactId,
      decisionRole: input.decisionRole ?? "unknown",
      isPrimary,
      addedBy: actor.id,
    });
  } catch (err) {
    if (err instanceof DealContactAlreadyLinkedError) return { ok: false, code: "already_linked" };
    throw err;
  }

  await writeAudit({
    tenantId: actor.tenantId,
    actorId: actor.id,
    entityType: "deal",
    entityId: dealId,
    action: "contact.link_to_deal",
    after: { contactId: input.contactId, isPrimary, decisionRole: input.decisionRole ?? "unknown" },
  });

  return { ok: true, isPrimary };
}

export interface DealContactsSection {
  canAddContact: boolean;
  contacts: DealContactRow[];
  showSingleThreadingWarning: boolean;
  // Active contacts at the deal's own account not yet linked to it - the Add Contact modal's "pick
  // an existing contact" list. Always empty when canAddContact is false (not fetched at all - no
  // point loading a picker nobody can use).
  availableContacts: Contact[];
}

// For the deal detail page's Stakeholders section (M5.6) to render its contact cards and decide
// whether to show the Add Contact button - one round trip, the same getAddTaskContext shape
// src/services/tasks.ts already established (bundled with the boolean, not a separate
// canAddContact-only call, since a caller needing one always needs the other from the same deal
// fetch). currentStageSortOrder is the caller's own already-fetched value (getDealDetail, M1.6) -
// not re-fetched here, since the page already has it and getDealForAuthorization doesn't carry it.
//
// showSingleThreadingWarning uses isPastFirstOpenStage's own ⚠ unconfirmed default (see
// src/domain/deal.ts's own comment and docs/DECISIONS.md's D-13) - "the tenant's own earliest
// open-type stage" is computed here via listOpenStages (already ordered by sort_order ascending),
// falling back to currentStageSortOrder itself (making the warning never fire) in the
// structurally-impossible case a tenant has no open stages at all, rather than crashing on an
// empty array.
export async function getDealContactsSection(
  supabase: SupabaseClient,
  actor: Actor,
  dealId: string,
  currentStageSortOrder: number,
): Promise<DealContactsSection> {
  const deal = await getDealForAuthorization(supabase, dealId);
  if (!deal) return { canAddContact: false, contacts: [], showSingleThreadingWarning: false, availableContacts: [] };

  const coOwnerIds = await listDealCoOwnerIds(supabase, dealId);
  const canAddContact = can(actor, "contact.link_to_deal", {
    tenantId: deal.tenantId,
    practiceLineId: deal.practiceLineId,
    ownerId: deal.ownerId ?? undefined,
    authorId: deal.authorId,
    coOwnerIds,
  });

  const [contacts, openStages, accountContacts] = await Promise.all([
    listDealContactsForDeal(supabase, dealId),
    listOpenStages(supabase),
    canAddContact ? listActiveContactsForAccount(supabase, deal.accountId) : Promise.resolve([]),
  ]);
  const firstOpenStageSortOrder = openStages[0]?.sortOrder ?? currentStageSortOrder;
  const showSingleThreadingWarning = showsSingleThreadingWarning(contacts.length, currentStageSortOrder, firstOpenStageSortOrder);

  const linkedContactIds = new Set(contacts.map((c) => c.contactId));
  const availableContacts = accountContacts.filter((c) => !linkedContactIds.has(c.id));

  return { canAddContact, contacts, showSingleThreadingWarning, availableContacts };
}
