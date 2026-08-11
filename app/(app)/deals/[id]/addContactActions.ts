"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionActor } from "@/services/actor";
import { createContact, linkContactToDeal } from "@/services/contacts";
import { addContactSchema, type AddContactFormValues } from "./addContactSchema";

export type AddContactActionResult = { ok: true } | { ok: false; message: string };

// Same plain-arguments server-action shape this directory's markDealWonAction/markDealLostAction
// already established for a client-driven modal interaction. accountId is the deal's own account
// (passed in by the caller, sourced from getDealDetail) - never user-entered, the same reasoning
// markWonActions.ts's own currencyCode comment gives for its field.
//
// "new" mode is create-then-link, not two separate actions the modal has to sequence itself: if
// createContact succeeds but linkContactToDeal then fails (e.g. the deal closed between the two
// calls), the newly-created contact is left in place, unlinked - a disclosed non-atomicity gap
// (CLAUDE.md's own "engagement history is append-only" invariant doesn't cover this join table, and
// nothing in docs/DECISIONS.md or the backlog asks for a two-step rollback here), the same tier of
// gap most compound writes in this codebase accept rather than reaching for a security-definer RPC
// (M5.2's closeDeal) every time.
export async function addContactToDealAction(dealId: string, accountId: string, input: AddContactFormValues): Promise<AddContactActionResult> {
  const parsed = addContactSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  if (session.status !== "active") {
    return { ok: false, message: "Your session has expired. Sign in again." };
  }

  let contactId: string;
  const decisionRole = parsed.data.decisionRole;

  if (parsed.data.mode === "existing") {
    contactId = parsed.data.contactId;
  } else {
    const created = await createContact(supabase, session.actor, {
      accountId,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName || null,
      jobTitle: parsed.data.jobTitle || null,
      email: parsed.data.email || null,
      phone: parsed.data.phone || null,
      linkedinUrl: parsed.data.linkedinUrl || null,
    });
    if (!created.ok) {
      return { ok: false, message: "You don't have permission to add a contact for this account." };
    }
    contactId = created.contact.id;
  }

  const result = await linkContactToDeal(supabase, session.actor, dealId, { contactId, decisionRole });
  if (result.ok) return { ok: true };

  switch (result.code) {
    case "denied":
      return { ok: false, message: "You don't have permission to add a contact to this deal." };
    case "not_found":
      return { ok: false, message: "That deal or contact could not be found." };
    case "contact_wrong_account":
      return { ok: false, message: "That contact doesn't belong to this deal's account." };
    case "already_linked":
      return { ok: false, message: "That contact is already linked to this deal." };
  }
}
