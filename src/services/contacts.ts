import type { SupabaseClient } from "@supabase/supabase-js";
import { can, type Action, type Actor } from "@/auth/permissions";
import { listPracticeLineIdsForAccount } from "@/data/accounts";
import { getContactForAuthorization, insertContact, type Contact } from "@/data/contacts";
// Re-exported so app/(app) only needs to import from this module - app may not import src/data
// directly (eslint.config.mjs boundaries), including for types.
export type { Contact };
import { countContactsForDeal, DealContactAlreadyLinkedError, insertDealContact } from "@/data/dealContacts";
import { listDealCoOwnerIds } from "@/data/dealCoOwners";
import { getDealForAuthorization } from "@/data/deals";
import { writeAudit } from "@/services/audit";
import type { DecisionRole } from "@/domain/contact";

// M5.5 (docs/07-build-backlog.md): "`contacts`, `deal_contacts` migrations; primary-contact
// invariant." An account can be entitled to MORE than one practice line (account_practice_owners is
// many-to-many, migration 0005's own "practice lines that sell into the same client" reasoning), so
// contact.create/contact.update's "practice" scope can't be checked with a single can()-Resource
// call the way a deal's own single practice_line_id can - this checks every practice line the
// account is entitled to, plus the tenant-wide case (a resource with no practiceLineId only ever
// satisfies a "tenant" token, never "practice" - see src/auth/permissions.ts's own tokenMatches),
// mirroring account_has_entitled_practice()'s own set-membership reasoning at the RLS layer.
async function actorEntitledToAccount(supabase: SupabaseClient, actor: Actor, action: Action, accountId: string): Promise<boolean> {
  if (can(actor, action, { tenantId: actor.tenantId })) return true;
  const practiceLineIds = await listPracticeLineIdsForAccount(supabase, accountId);
  return practiceLineIds.some((practiceLineId) => can(actor, action, { tenantId: actor.tenantId, practiceLineId }));
}

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
