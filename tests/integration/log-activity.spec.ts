import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSessionActor } from "@/services/actor";
import { logActivity } from "@/services/activities";
import { dateInTimezone } from "@/lib/dates";
import { findOrCreateByUniqueMatch, findOrCreateTenant, findOrCreateUser, signIn as signInAs } from "./support/permanentFixture";

// M3.2 exit criteria (docs/07-build-backlog.md): "logActivity service: the single creation path,
// deriving last_engaged_at, engagement_count and the audit row in one transaction." Exercises the
// real chain against the real hosted project: a real signed-in session, the real can() check, the
// real activities_insert RLS policy (migration 0008), migration 0009's trg_activity_refresh
// trigger, and the real audit write.
//
// logActivity writes to activities, which has its own FK to deals (deal_id, no cascade) - once an
// activity exists for a deal, that deal can never be deleted again, the same permanently-un-
// deletable chain tests/integration/pipeline-list.spec.ts's M2.1 fixture fix already documented for
// stage_events. This fixture is find-or-create for everything accordingly (reusing the shared
// findOrCreateByUniqueMatch/findOrCreateTenant/findOrCreateUser helpers that fix already promoted
// into tests/integration/support/permanentFixture.ts), never delete-and-recreate.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M3-2-Integration-Test-Pw1!";
const TIMEZONE = "Africa/Lagos";

let service: SupabaseClient;

const ids = {
  tenantId: "",
  practiceLineId: "",
  otherPracticeLineId: "",
  stageId: "",
  accountId: "",
  bdeAuthId: "",
  otherPracticeBdeAuthId: "",
  executiveAuthId: "",
  dealId: "",
  linkedContactId: "",
  notLinkedContactId: "",
};

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

beforeAll(async () => {
  service = createServiceClient();

  ids.tenantId = await findOrCreateTenant(service, "m3-2-integration-test", "M3.2 Integration Test Tenant");

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

  ids.stageId = await findOrCreateByUniqueMatch(
    service,
    "pipeline_stages",
    { tenant_id: ids.tenantId, code: "DISCOVERY" },
    { tenant_id: ids.tenantId, name: "Discovery", code: "DISCOVERY", sort_order: 1, probability_threshold: 20, stage_type: "open" },
  );

  ids.accountId = await findOrCreateByUniqueMatch(
    service,
    "accounts",
    { tenant_id: ids.tenantId, name: "M3.2 Test Client" },
    { tenant_id: ids.tenantId, name: "M3.2 Test Client" },
  );

  ids.bdeAuthId = await findOrCreateUser(service, ids.tenantId, "m3-2-bde@example.com", "M3.2 Bde", PASSWORD);
  ids.otherPracticeBdeAuthId = await findOrCreateUser(service, ids.tenantId, "m3-2-bde-other-practice@example.com", "M3.2 Bde Other Practice", PASSWORD);
  ids.executiveAuthId = await findOrCreateUser(service, ids.tenantId, "m3-2-executive@example.com", "M3.2 Executive", PASSWORD);

  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  await service.from("user_roles").insert([
    { tenant_id: ids.tenantId, user_id: ids.bdeAuthId, role: "bde", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.otherPracticeBdeAuthId, role: "bde", practice_line_id: ids.otherPracticeLineId },
    { tenant_id: ids.tenantId, user_id: ids.executiveAuthId, role: "executive", practice_line_id: null },
  ]);

  // D-03: an account is only visible under accounts_select (migration 0005) via
  // account_practice_owners, not by tenant/role alone - without this, the deal detail page's
  // accounts(...) embed (app/(app)/deals/[id]/page.tsx's getDealDetail) silently comes back null
  // for a bde, even though this spec's own service-layer tests never surfaced that (logActivity
  // never fetches the account). Found via manual browser QA of M3.4's Log Activity modal against
  // this exact fixture - fixed here so a future UI check against this tenant doesn't hit it again.
  await service.from("account_practice_owners").delete().eq("account_id", ids.accountId);
  await service
    .from("account_practice_owners")
    .insert({ account_id: ids.accountId, practice_line_id: ids.practiceLineId, owner_id: ids.bdeAuthId });

  ids.dealId = await findOrCreateByUniqueMatch(
    service,
    "deals",
    { tenant_id: ids.tenantId, reference: "D-LOGACT-1" },
    {
      tenant_id: ids.tenantId,
      reference: "D-LOGACT-1",
      name: "Log Activity Test Deal",
      account_id: ids.accountId,
      practice_line_id: ids.practiceLineId,
      stage_id: ids.stageId,
      client_type: "new",
      owner_id: ids.bdeAuthId,
      author_id: ids.bdeAuthId,
      status: "active",
      expected_close_date: "2027-06-01",
    },
  );

  // M5.7's own contactIds fixture - one contact linked to the deal (deal_contacts), one deliberately
  // not, to reach both logActivity's friendly pre-check and its success path.
  ids.linkedContactId = await findOrCreateByUniqueMatch(
    service,
    "contacts",
    { tenant_id: ids.tenantId, account_id: ids.accountId, first_name: "LogActivityLinked" },
    { tenant_id: ids.tenantId, account_id: ids.accountId, first_name: "LogActivityLinked" },
  );
  ids.notLinkedContactId = await findOrCreateByUniqueMatch(
    service,
    "contacts",
    { tenant_id: ids.tenantId, account_id: ids.accountId, first_name: "LogActivityNotLinked" },
    { tenant_id: ids.tenantId, account_id: ids.accountId, first_name: "LogActivityNotLinked" },
  );
  const { data: existingLink } = await service
    .from("deal_contacts")
    .select("deal_id")
    .eq("deal_id", ids.dealId)
    .eq("contact_id", ids.linkedContactId)
    .maybeSingle();
  if (!existingLink) {
    await service
      .from("deal_contacts")
      .insert({ deal_id: ids.dealId, contact_id: ids.linkedContactId, is_primary: true, added_by: ids.bdeAuthId });
  }
});

afterAll(async () => {
  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  // Deliberately not deleting activities, the deal, the account, the stage, the practice lines, the
  // users, the contacts, deal_contacts, or the tenant - see this file's header comment. beforeAll is
  // find-or-create for all of these.
});

describe("logActivity, end to end against a real signed-in session", () => {
  it("the deal's owning bde can log a client-facing activity; last_engaged_at and engagement_count update, and exactly one audit row is written", async () => {
    const client = await signIn("m3-2-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const { count: auditCountBefore } = await service
      .from("audit_entries")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "activity");

    const today = dateInTimezone(new Date().toISOString(), TIMEZONE);
    const result = await logActivity(client, session.actor, TIMEZONE, {
      dealId: ids.dealId,
      type: "call",
      activityDate: today,
      summary: "Real chain test call",
      outcome: "Positive first conversation",
      outcomeDisposition: "positive",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.activity.isClientFacing).toBe(true);

    const { data: activityRow } = await service
      .from("activities")
      .select("author_id, stage_id_at_time, tenant_id")
      .eq("id", result.activity.id)
      .single();
    expect(activityRow?.author_id).toBe(ids.bdeAuthId);
    expect(activityRow?.stage_id_at_time).toBe(ids.stageId);
    expect(activityRow?.tenant_id).toBe(ids.tenantId);

    const { data: dealRow } = await service
      .from("deals")
      .select("last_engaged_at, last_engaged_activity_id, engagement_count")
      .eq("id", ids.dealId)
      .single();
    expect(dealRow?.last_engaged_activity_id).toBe(result.activity.id);
    expect(dealRow?.engagement_count).toBeGreaterThan(0);
    expect(new Date(dealRow!.last_engaged_at).toISOString().slice(0, 10)).toBe(today);

    const { count: auditCountAfter } = await service
      .from("audit_entries")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "activity");
    expect(auditCountAfter).toBe((auditCountBefore ?? 0) + 1);

    const { data: auditRows } = await service
      .from("audit_entries")
      .select("action, actor_id, entity_id")
      .eq("entity_id", result.activity.id);
    expect(auditRows).toHaveLength(1);
    expect(auditRows?.[0]).toMatchObject({ action: "activity.create", actor_id: ids.bdeAuthId, entity_id: result.activity.id });
  });

  it("an internal (non-client-facing) activity is logged but does not advance last_engaged_at", async () => {
    const client = await signIn("m3-2-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const before = await service.from("deals").select("last_engaged_at").eq("id", ids.dealId).single();

    const result = await logActivity(client, session.actor, TIMEZONE, {
      dealId: ids.dealId,
      type: "internal_review",
      activityDate: dateInTimezone(new Date().toISOString(), TIMEZONE),
      summary: "Internal pricing review",
      outcome: null,
      outcomeDisposition: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.activity.isClientFacing).toBe(false);

    const after = await service.from("deals").select("last_engaged_at").eq("id", ids.dealId).single();
    expect(new Date(after.data!.last_engaged_at).getTime()).toBe(new Date(before.data!.last_engaged_at).getTime());
  });

  it("a bde outside the deal's practice can't even see it - not_found", async () => {
    const client = await signIn("m3-2-bde-other-practice@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await logActivity(client, session.actor, TIMEZONE, {
      dealId: ids.dealId,
      type: "call",
      activityDate: dateInTimezone(new Date().toISOString(), TIMEZONE),
      summary: "Should never be written",
      outcome: null,
      outcomeDisposition: null,
    });
    expect(result).toEqual({ ok: false, code: "not_found" });
  });

  it("an executive (tenant-wide read, never write) is denied, even though they can see the deal", async () => {
    const client = await signIn("m3-2-executive@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await logActivity(client, session.actor, TIMEZONE, {
      dealId: ids.dealId,
      type: "call",
      activityDate: dateInTimezone(new Date().toISOString(), TIMEZONE),
      summary: "Should never be written",
      outcome: null,
      outcomeDisposition: null,
    });
    expect(result).toEqual({ ok: false, code: "denied" });
  });

  it("a future activity_date is rejected in the actor's own timezone, before any insert is attempted", async () => {
    const client = await signIn("m3-2-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const { count: before } = await service
      .from("activities")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", ids.dealId);

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const result = await logActivity(client, session.actor, TIMEZONE, {
      dealId: ids.dealId,
      type: "call",
      activityDate: tomorrow,
      summary: "Tomorrow's call, logged too early",
      outcome: null,
      outcomeDisposition: null,
    });
    expect(result).toEqual({ ok: false, code: "activity_date_in_future" });

    const { count: after } = await service
      .from("activities")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", ids.dealId);
    expect(after).toBe(before);
  });

  // M5.7 exit criteria (docs/07-build-backlog.md): "Activity attribution to contacts; contact-level
  // last-engaged." Proves the friendly pre-check (contact_not_linked, before any insert) and the
  // success path (activity_contacts row written, contacts.last_engaged_at advanced) end to end
  // against the real hosted project.
  it("attributing an already-linked contact writes activity_contacts and advances that contact's own last_engaged_at", async () => {
    const client = await signIn("m3-2-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const today = dateInTimezone(new Date().toISOString(), TIMEZONE);
    const result = await logActivity(client, session.actor, TIMEZONE, {
      dealId: ids.dealId,
      type: "call",
      activityDate: today,
      summary: "Call with the linked contact present",
      outcome: null,
      outcomeDisposition: null,
      contactIds: [ids.linkedContactId],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { data: attributionRow } = await service
      .from("activity_contacts")
      .select("contact_id")
      .eq("activity_id", result.activity.id)
      .maybeSingle();
    expect(attributionRow?.contact_id).toBe(ids.linkedContactId);

    const { data: contactRow } = await service.from("contacts").select("last_engaged_at").eq("id", ids.linkedContactId).single();
    expect(contactRow?.last_engaged_at).toBe(today);
  });

  it("rejects a contactId not linked to the deal before any insert is attempted", async () => {
    const client = await signIn("m3-2-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const { count: before } = await service
      .from("activities")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", ids.dealId);

    const result = await logActivity(client, session.actor, TIMEZONE, {
      dealId: ids.dealId,
      type: "call",
      activityDate: dateInTimezone(new Date().toISOString(), TIMEZONE),
      summary: "Should never be written",
      outcome: null,
      outcomeDisposition: null,
      contactIds: [ids.notLinkedContactId],
    });
    expect(result).toEqual({ ok: false, code: "contact_not_linked" });

    const { count: after } = await service
      .from("activities")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", ids.dealId);
    expect(after).toBe(before);
  });
});
