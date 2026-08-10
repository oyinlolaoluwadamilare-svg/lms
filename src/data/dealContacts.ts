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
