import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSessionActor } from "@/services/actor";
import { createContact, getDealContactsSection, linkContactToDeal } from "@/services/contacts";
import { findOrCreateByUniqueMatch, findOrCreateTenant, findOrCreateUser, signIn as signInAs } from "./support/permanentFixture";

// M5.5 exit criteria (docs/07-build-backlog.md): "`contacts`, `deal_contacts` migrations;
// primary-contact invariant." Proves createContact and linkContactToDeal end to end against the
// real hosted project, through real signed-in sessions: a bde entitled to the account's practice
// can create a contact and link it to their own deal (becoming primary automatically, since it's
// the deal's first); a bde with no entitlement to the account is denied creating a contact there;
// a bde outside the deal's own practice can't even see the deal at all (not_found, the same
// RLS-invisibility-not-distinguished-from-denied precedent changeStage/logActivity already
// established); linking a contact from a different (but visible) account than the deal is rejected
// with a clean result code (not a raw exception from migration 0018's own trigger backstop); and a
// second contact linked to the same deal is correctly NOT primary.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M5-5-Integration-Test-Pw1!";

let service: SupabaseClient;

const ids = {
  tenantId: "",
  practiceLineId: "",
  otherPracticeLineId: "",
  openStageId: "",
  accountId: "",
  otherAccountId: "",
  entitledOtherAccountId: "",
  bdeAuthId: "",
  otherPracticeBdeAuthId: "",
  dealId: "",
  secondDealId: "",
};

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

beforeAll(async () => {
  service = createServiceClient();

  ids.tenantId = await findOrCreateTenant(service, "m5-5-integration-test", "M5.5 Integration Test Tenant");
  ids.practiceLineId = await findOrCreateByUniqueMatch(
    service,
    "practice_lines",
    { tenant_id: ids.tenantId, code: "ADV" },
    { tenant_id: ids.tenantId, name: "Advisory", code: "ADV" },
  );
  ids.otherPracticeLineId = await findOrCreateByUniqueMatch(
    service,
    "practice_lines",
    { tenant_id: ids.tenantId, code: "ES" },
    { tenant_id: ids.tenantId, name: "Executive Search", code: "ES" },
  );
  ids.openStageId = await findOrCreateByUniqueMatch(
    service,
    "pipeline_stages",
    { tenant_id: ids.tenantId, code: "DISCOVERY" },
    { tenant_id: ids.tenantId, name: "Discovery", code: "DISCOVERY", sort_order: 1, probability_threshold: 20, stage_type: "open" },
  );
  ids.accountId = await findOrCreateByUniqueMatch(
    service,
    "accounts",
    { tenant_id: ids.tenantId, name: "M5.5 Test Client" },
    { tenant_id: ids.tenantId, name: "M5.5 Test Client" },
  );
  ids.otherAccountId = await findOrCreateByUniqueMatch(
    service,
    "accounts",
    { tenant_id: ids.tenantId, name: "M5.5 Other Client" },
    { tenant_id: ids.tenantId, name: "M5.5 Other Client" },
  );
  // Entitled to the SAME practice line as the deal's own account, so a contact on it stays visible
  // to ids.bdeAuthId under contacts_select's RLS - unlike ids.otherAccountId (deliberately given no
  // entitlement below, for the "denied creating a contact" case), this account exists specifically
  // to reach linkContactToDeal's contact_wrong_account check itself, rather than tripping RLS
  // invisibility (not_found) before that check is ever reached.
  ids.entitledOtherAccountId = await findOrCreateByUniqueMatch(
    service,
    "accounts",
    { tenant_id: ids.tenantId, name: "M5.5 Entitled Other Client" },
    { tenant_id: ids.tenantId, name: "M5.5 Entitled Other Client" },
  );

  ids.bdeAuthId = await findOrCreateUser(service, ids.tenantId, "m5-5-bde@example.com", "M5.5 Bde", PASSWORD);
  ids.otherPracticeBdeAuthId = await findOrCreateUser(service, ids.tenantId, "m5-5-other-practice-bde@example.com", "M5.5 Other Bde", PASSWORD);

  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  const { error: roleError } = await service.from("user_roles").insert([
    { tenant_id: ids.tenantId, user_id: ids.bdeAuthId, role: "bde", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.otherPracticeBdeAuthId, role: "bde", practice_line_id: ids.otherPracticeLineId },
  ]);
  if (roleError) throw new Error(`fixture role grant failed: ${roleError.message}`);

  await service.from("account_practice_owners").delete().in("account_id", [ids.accountId, ids.entitledOtherAccountId]);
  const { error: apoError } = await service.from("account_practice_owners").insert([
    { account_id: ids.accountId, practice_line_id: ids.practiceLineId, owner_id: ids.bdeAuthId },
    { account_id: ids.entitledOtherAccountId, practice_line_id: ids.practiceLineId, owner_id: ids.bdeAuthId },
  ]);
  if (apoError) throw new Error(`fixture account_practice_owners failed: ${apoError.message}`);
  // otherAccountId is deliberately given NO account_practice_owners row for ids.practiceLineId -
  // used below to prove a bde with no entitlement to an account is denied creating a contact there.

  const { data: existingDeal } = await service.from("deals").select("id").eq("tenant_id", ids.tenantId).eq("reference", "D-5-5-1").maybeSingle();
  if (existingDeal) {
    ids.dealId = existingDeal.id;
    await service.from("deal_contacts").delete().eq("deal_id", ids.dealId);
  } else {
    const { data: created, error: dealError } = await service
      .from("deals")
      .insert({
        tenant_id: ids.tenantId,
        reference: "D-5-5-1",
        name: "M5.5 Contacts Test Deal",
        account_id: ids.accountId,
        practice_line_id: ids.practiceLineId,
        stage_id: ids.openStageId,
        client_type: "new",
        owner_id: ids.bdeAuthId,
        author_id: ids.bdeAuthId,
        status: "active",
        expected_close_date: "2027-03-01",
      })
      .select("id")
      .single();
    if (dealError) throw new Error(`seed deal failed: ${dealError.message}`);
    ids.dealId = created.id;
  }

  // M5.6's own deal fixture - kept separate from ids.dealId so getDealContactsSection's
  // single-threading-warning tests can start from zero linked contacts without disturbing the
  // deal_contacts state the tests above leave behind on ids.dealId.
  const { data: existingSecondDeal } = await service
    .from("deals")
    .select("id")
    .eq("tenant_id", ids.tenantId)
    .eq("reference", "D-5-6-1")
    .maybeSingle();
  if (existingSecondDeal) {
    ids.secondDealId = existingSecondDeal.id;
    await service.from("deal_contacts").delete().eq("deal_id", ids.secondDealId);
  } else {
    const { data: created, error: dealError } = await service
      .from("deals")
      .insert({
        tenant_id: ids.tenantId,
        reference: "D-5-6-1",
        name: "M5.6 Contacts Section Test Deal",
        account_id: ids.accountId,
        practice_line_id: ids.practiceLineId,
        stage_id: ids.openStageId,
        client_type: "new",
        owner_id: ids.bdeAuthId,
        author_id: ids.bdeAuthId,
        status: "active",
        expected_close_date: "2027-03-01",
      })
      .select("id")
      .single();
    if (dealError) throw new Error(`seed second deal failed: ${dealError.message}`);
    ids.secondDealId = created.id;
  }

  await service.from("contacts").delete().eq("tenant_id", ids.tenantId);
});

afterAll(async () => {
  await service.from("deal_contacts").delete().eq("deal_id", ids.dealId);
  await service.from("deal_contacts").delete().eq("deal_id", ids.secondDealId);
  await service.from("contacts").delete().eq("tenant_id", ids.tenantId);
  await service.from("account_practice_owners").delete().in("account_id", [ids.accountId, ids.entitledOtherAccountId]);
  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  // deals/accounts/practice_lines/tenants/users left in place: once a deal here gets a
  // deal_contacts row, migration 0018's own tables carry no forbid_mutation trigger, so these
  // specific rows stay safely deletable - but the deal itself is a permanent fixture the same way
  // pipeline-list.spec.ts's own advisory deal is, reused rather than recreated across runs.
});

describe("createContact and linkContactToDeal, end to end against a real signed-in session", () => {
  it("a bde entitled to the account's practice can create a contact there", async () => {
    const client = await signIn("m5-5-bde@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await createContact(client, session.actor, {
      accountId: ids.accountId,
      firstName: "Alice",
      lastName: "Anderson",
      jobTitle: "CFO",
      email: null,
      phone: null,
      linkedinUrl: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contact.firstName).toBe("Alice");
    expect(result.contact.accountId).toBe(ids.accountId);

    const { data: auditRows } = await service
      .from("audit_entries")
      .select("action, actor_id")
      .eq("entity_type", "contact")
      .eq("entity_id", result.contact.id);
    expect(auditRows).toHaveLength(1);
    expect(auditRows?.[0]?.action).toBe("contact.create");
  });

  it("a bde with no entitlement to the account is denied creating a contact there", async () => {
    const client = await signIn("m5-5-other-practice-bde@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await createContact(client, session.actor, {
      accountId: ids.otherAccountId,
      firstName: "Should Not Exist",
      lastName: null,
      jobTitle: null,
      email: null,
      phone: null,
      linkedinUrl: null,
    });

    expect(result).toEqual({ ok: false, code: "denied" });
  });

  it("linking the deal's first contact makes it primary automatically", async () => {
    const client = await signIn("m5-5-bde@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const created = await createContact(client, session.actor, {
      accountId: ids.accountId,
      firstName: "Bob",
      lastName: "Brown",
      jobTitle: null,
      email: null,
      phone: null,
      linkedinUrl: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await linkContactToDeal(client, session.actor, ids.dealId, { contactId: created.contact.id, decisionRole: "champion" });
    expect(result).toEqual({ ok: true, isPrimary: true });

    const { data: row } = await service
      .from("deal_contacts")
      .select("is_primary, decision_role")
      .eq("deal_id", ids.dealId)
      .eq("contact_id", created.contact.id)
      .single();
    expect(row?.is_primary).toBe(true);
    expect(row?.decision_role).toBe("champion");
  });

  it("linking a second contact to the same deal is correctly NOT primary", async () => {
    const client = await signIn("m5-5-bde@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const created = await createContact(client, session.actor, {
      accountId: ids.accountId,
      firstName: "Carol",
      lastName: "Clark",
      jobTitle: null,
      email: null,
      phone: null,
      linkedinUrl: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await linkContactToDeal(client, session.actor, ids.dealId, { contactId: created.contact.id });
    expect(result).toEqual({ ok: true, isPrimary: false });
  });

  it("a bde outside the deal's practice can't even see the deal - not_found, the same as changeStage/logActivity's own precedent", async () => {
    const client = await signIn("m5-5-other-practice-bde@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const { data: anyContact } = await service.from("contacts").select("id").eq("account_id", ids.accountId).limit(1).single();
    const result = await linkContactToDeal(client, session.actor, ids.dealId, { contactId: anyContact!.id });
    expect(result).toEqual({ ok: false, code: "not_found" });
  });

  it("rejects linking a contact from a different (but visible) account than the deal, with a clean result code", async () => {
    const client = await signIn("m5-5-bde@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const { data: otherAccountContact, error } = await service
      .from("contacts")
      .insert({ tenant_id: ids.tenantId, account_id: ids.entitledOtherAccountId, first_name: "Wrong Account Contact" })
      .select("id")
      .single();
    if (error) throw new Error(`seed wrong-account contact failed: ${error.message}`);

    const result = await linkContactToDeal(client, session.actor, ids.dealId, { contactId: otherAccountContact.id });
    expect(result).toEqual({ ok: false, code: "contact_wrong_account" });
  });

  it("rejects linking the same contact to the same deal twice", async () => {
    const client = await signIn("m5-5-bde@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const { data: alreadyLinked } = await service.from("deal_contacts").select("contact_id").eq("deal_id", ids.dealId).limit(1).single();
    const result = await linkContactToDeal(client, session.actor, ids.dealId, { contactId: alreadyLinked!.contact_id });
    expect(result).toEqual({ ok: false, code: "already_linked" });
  });
});

// M5.6 exit criteria (docs/07-build-backlog.md): "Contact management on the deal with decision-role
// badges; single-threading warning past Discovery." Proves getDealContactsSection end to end: the
// bundled canAddContact/availableContacts picker data, and the single-threading warning's ⚠
// unconfirmed default (docs/DECISIONS.md's D-13) - false at the first open stage regardless of
// contact count, true once past it with fewer than two contacts, clearing at exactly two. Runs
// against ids.secondDealId (a fixture kept separate from ids.dealId, above) specifically so these
// assertions can start from zero linked contacts.
describe("getDealContactsSection, end to end against a real signed-in session", () => {
  it("canAddContact is true for an entitled bde, and availableContacts lists an unlinked account contact", async () => {
    const client = await signIn("m5-5-bde@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const created = await createContact(client, session.actor, {
      accountId: ids.accountId,
      firstName: "Dana",
      lastName: "Diallo",
      jobTitle: null,
      email: null,
      phone: null,
      linkedinUrl: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const section = await getDealContactsSection(client, session.actor, ids.secondDealId, 1);
    expect(section.canAddContact).toBe(true);
    expect(section.availableContacts.some((c) => c.id === created.contact.id)).toBe(true);
    expect(section.contacts).toHaveLength(0);
  });

  it("is false at the first open stage even with zero contacts", async () => {
    const client = await signIn("m5-5-bde@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    // sort_order 1 is ids.openStageId's own value (the fixture's Discovery stage, seeded above) -
    // the tenant's only open stage, so it is always the "first" one listOpenStages returns.
    const section = await getDealContactsSection(client, session.actor, ids.secondDealId, 1);
    expect(section.showSingleThreadingWarning).toBe(false);
  });

  it("is true once past the first open stage with fewer than two contacts, and clears once a second is linked", async () => {
    const client = await signIn("m5-5-bde@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const zeroContacts = await getDealContactsSection(client, session.actor, ids.secondDealId, 2);
    expect(zeroContacts.showSingleThreadingWarning).toBe(true);

    const { data: danaContact } = await service.from("contacts").select("id").eq("account_id", ids.accountId).eq("first_name", "Dana").single();
    const firstLink = await linkContactToDeal(client, session.actor, ids.secondDealId, { contactId: danaContact!.id });
    expect(firstLink).toEqual({ ok: true, isPrimary: true });

    const oneContact = await getDealContactsSection(client, session.actor, ids.secondDealId, 2);
    expect(oneContact.showSingleThreadingWarning).toBe(true);
    expect(oneContact.availableContacts.some((c) => c.id === danaContact!.id)).toBe(false);

    const secondContact = await createContact(client, session.actor, {
      accountId: ids.accountId,
      firstName: "Erin",
      lastName: "Ekwueme",
      jobTitle: null,
      email: null,
      phone: null,
      linkedinUrl: null,
    });
    expect(secondContact.ok).toBe(true);
    if (!secondContact.ok) return;

    const secondLink = await linkContactToDeal(client, session.actor, ids.secondDealId, { contactId: secondContact.contact.id });
    expect(secondLink).toEqual({ ok: true, isPrimary: false });

    const twoContacts = await getDealContactsSection(client, session.actor, ids.secondDealId, 2);
    expect(twoContacts.showSingleThreadingWarning).toBe(false);
    expect(twoContacts.contacts).toHaveLength(2);
  });
});
