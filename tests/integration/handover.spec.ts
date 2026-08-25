import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSessionActor } from "@/services/actor";
import { changeDealOwner } from "@/services/deals";
import { reassignAccountPracticeOwner } from "@/services/accounts";
import { findOrCreateByUniqueMatch, findOrCreateTenant, findOrCreateUser, signIn as signInAs } from "./support/permanentFixture";

// M5.9 exit criteria (docs/07-build-backlog.md): "Handover panel: last ten engagements, open tasks
// and contacts, shown on owner change." Proves both owner-change paths end to end against the real
// hosted project, through real signed-in sessions: changeDealOwner (deals.owner_id) and
// reassignAccountPracticeOwner (account_practice_owners.owner_id, D-03's own per-practice-line
// shape) both correctly deny a bde (even though deals_update/account_practice_owners_update's own
// RLS is column-blind and would technically allow the raw update - tests/rls/
// deals_permission_matrix.spec.ts's own documented gap for deal.change_owner), correctly allow a
// team_lead within their own practice, and return a populated handover summary (the deal's own
// recent engagement, open task and linked contact) on success.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M5-9-Integration-Test-Pw1!";
const TIMEZONE = "Africa/Lagos";

let service: SupabaseClient;

const ids = {
  tenantId: "",
  practiceLineId: "",
  otherPracticeLineId: "",
  stageId: "",
  accountId: "",
  teamLeadAuthId: "",
  bdeAAuthId: "",
  bdeBAuthId: "",
  otherPracticeBdeAuthId: "",
  dealId: "",
  contactId: "",
  taskId: "",
};

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

beforeAll(async () => {
  service = createServiceClient();

  ids.tenantId = await findOrCreateTenant(service, "m5-9-integration-test", "M5.9 Integration Test Tenant");

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

  ids.teamLeadAuthId = await findOrCreateUser(service, ids.tenantId, "m5-9-team-lead@example.com", "M5.9 Team Lead", PASSWORD);
  ids.bdeAAuthId = await findOrCreateUser(service, ids.tenantId, "m5-9-bde-a@example.com", "M5.9 Bde A", PASSWORD);
  ids.bdeBAuthId = await findOrCreateUser(service, ids.tenantId, "m5-9-bde-b@example.com", "M5.9 Bde B", PASSWORD);
  ids.otherPracticeBdeAuthId = await findOrCreateUser(service, ids.tenantId, "m5-9-other-practice-bde@example.com", "M5.9 Other Practice Bde", PASSWORD);

  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  await service.from("user_roles").insert([
    { tenant_id: ids.tenantId, user_id: ids.teamLeadAuthId, role: "team_lead", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.bdeAAuthId, role: "bde", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.bdeBAuthId, role: "bde", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.otherPracticeBdeAuthId, role: "bde", practice_line_id: ids.otherPracticeLineId },
  ]);

  ids.accountId = await findOrCreateByUniqueMatch(
    service,
    "accounts",
    { tenant_id: ids.tenantId, name: "M5.9 Handover Test Client" },
    { tenant_id: ids.tenantId, name: "M5.9 Handover Test Client" },
  );
  await service.from("account_practice_owners").delete().eq("account_id", ids.accountId);
  await service
    .from("account_practice_owners")
    .insert({ account_id: ids.accountId, practice_line_id: ids.practiceLineId, owner_id: ids.bdeAAuthId });

  ids.dealId = await findOrCreateByUniqueMatch(
    service,
    "deals",
    { tenant_id: ids.tenantId, reference: "D-5-9-1" },
    {
      tenant_id: ids.tenantId,
      reference: "D-5-9-1",
      name: "M5.9 Handover Test Deal",
      account_id: ids.accountId,
      practice_line_id: ids.practiceLineId,
      stage_id: ids.stageId,
      client_type: "new",
      owner_id: ids.bdeAAuthId,
      author_id: ids.bdeAAuthId,
      status: "active",
      expected_close_date: "2027-06-01",
    },
  );

  // A linked contact (deal_contacts) and an open task, both on the same deal, so the handover
  // summary has real, non-empty content to assert on.
  ids.contactId = await findOrCreateByUniqueMatch(
    service,
    "contacts",
    { tenant_id: ids.tenantId, account_id: ids.accountId, first_name: "HandoverContact" },
    { tenant_id: ids.tenantId, account_id: ids.accountId, first_name: "HandoverContact" },
  );
  await service.from("deal_contacts").delete().eq("deal_id", ids.dealId).eq("contact_id", ids.contactId);
  await service
    .from("deal_contacts")
    .insert({ deal_id: ids.dealId, contact_id: ids.contactId, is_primary: true, added_by: ids.bdeAAuthId });

  await service.from("activities").delete().eq("deal_id", ids.dealId).eq("summary", "Handover fixture call");
  await service.from("activities").insert({
    tenant_id: ids.tenantId,
    deal_id: ids.dealId,
    type: "call",
    activity_date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    summary: "Handover fixture call",
    author_id: ids.bdeAAuthId,
  });

  const { data: existingTask } = await service
    .from("tasks")
    .select("id")
    .eq("tenant_id", ids.tenantId)
    .eq("title", "Handover fixture task")
    .maybeSingle();
  if (existingTask) {
    ids.taskId = existingTask.id;
    await service.from("tasks").update({ status: "open" }).eq("id", ids.taskId);
  } else {
    const { data: created, error } = await service
      .from("tasks")
      .insert({
        tenant_id: ids.tenantId,
        deal_id: ids.dealId,
        title: "Handover fixture task",
        due_date: "2027-06-01",
        priority: "normal",
        status: "open",
        assignee_id: ids.bdeAAuthId,
        assigned_by: ids.bdeAAuthId,
      })
      .select("id")
      .single();
    if (error) throw new Error(`seed task failed: ${error.message}`);
    ids.taskId = created.id;
  }
});

afterAll(async () => {
  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  // Deliberately not deleting deals/tasks/activities/deal_contacts/account_practice_owners/
  // accounts/contacts/practice_lines/users/tenant - deals/activities/tasks are all permanently
  // un-deletable once seeded via their own FK-pinning chains (the same reasoning every other
  // integration fixture in this codebase already documents). beforeAll is find-or-create for all
  // of these; owner_id is reset explicitly below since these tests mutate it directly.
  await service.from("deals").update({ owner_id: ids.bdeAAuthId }).eq("id", ids.dealId);
  await service.from("account_practice_owners").update({ owner_id: ids.bdeAAuthId }).eq("account_id", ids.accountId).eq("practice_line_id", ids.practiceLineId);
});

describe("changeDealOwner, end to end against a real signed-in session", () => {
  it("a bde is denied, even though deals_update's own RLS is column-blind and would allow the raw update", async () => {
    const client = await signIn("m5-9-bde-a@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await changeDealOwner(client, session.actor, ids.dealId, ids.bdeBAuthId);
    expect(result).toEqual({ ok: false, code: "denied" });

    const { data: dealRow } = await service.from("deals").select("owner_id").eq("id", ids.dealId).single();
    expect(dealRow?.owner_id).toBe(ids.bdeAAuthId);
  });

  it("a bde outside the deal's practice can't even see it - not_found", async () => {
    const client = await signIn("m5-9-other-practice-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await changeDealOwner(client, session.actor, ids.dealId, ids.bdeBAuthId);
    expect(result).toEqual({ ok: false, code: "not_found" });
  });

  it("the team_lead can change the owner within their own practice, and the handover summary reflects this deal", async () => {
    const client = await signIn("m5-9-team-lead@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    // Delta, not exact-length: dealId is a find-or-create fixture (see this file's afterAll
    // comment), so its audit_entries history correctly accumulates across every real run of this
    // suite against the hosted project (CLAUDE.md #4's append-only rule), the same reasoning
    // tests/integration/close-deal.spec.ts's own audit assertions already use.
    const { count: auditCountBefore } = await service
      .from("audit_entries")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "deal")
      .eq("entity_id", ids.dealId)
      .eq("action", "deal.change_owner");

    const result = await changeDealOwner(client, session.actor, ids.dealId, ids.bdeBAuthId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { data: dealRow } = await service.from("deals").select("owner_id").eq("id", ids.dealId).single();
    expect(dealRow?.owner_id).toBe(ids.bdeBAuthId);

    expect(result.handover.recentEngagements.some((e) => e.kind === "activity" && e.summary === "Handover fixture call")).toBe(true);
    expect(result.handover.openTasks.some((t) => t.id === ids.taskId)).toBe(true);
    expect(result.handover.contacts.some((c) => c.contactId === ids.contactId)).toBe(true);

    const { data: auditRows, count: auditCountAfter } = await service
      .from("audit_entries")
      .select("action, actor_id", { count: "exact" })
      .eq("entity_type", "deal")
      .eq("entity_id", ids.dealId)
      .eq("action", "deal.change_owner")
      .order("occurred_at", { ascending: false })
      .limit(1);
    expect(auditCountAfter).toBe((auditCountBefore ?? 0) + 1);
    expect(auditRows?.[0]?.actor_id).toBe(ids.teamLeadAuthId);
  });

  it("rejects reassigning to the same owner", async () => {
    const client = await signIn("m5-9-team-lead@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    // The deal's owner is now bdeB (previous test) - reassigning to bdeB again is a no-op.
    const result = await changeDealOwner(client, session.actor, ids.dealId, ids.bdeBAuthId);
    expect(result).toEqual({ ok: false, code: "same_owner" });
  });
});

describe("reassignAccountPracticeOwner, end to end against a real signed-in session", () => {
  it("a bde is denied, even though account_practice_owners_update's own RLS is column-blind and would allow the raw update", async () => {
    const client = await signIn("m5-9-bde-a@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await reassignAccountPracticeOwner(client, session.actor, ids.accountId, ids.practiceLineId, ids.bdeBAuthId, TIMEZONE);
    expect(result).toEqual({ ok: false, code: "denied" });
  });

  it("the team_lead can reassign the practice-line owner, and the handover summary spans that practice's own deals on this account", async () => {
    const client = await signIn("m5-9-team-lead@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    // Delta, not exact-length: accountId is a find-or-create fixture (see this file's afterAll
    // comment), so its audit_entries history correctly accumulates across every real run of this
    // suite against the hosted project (CLAUDE.md #4's append-only rule), the same reasoning
    // tests/integration/close-deal.spec.ts's own audit assertions already use.
    const { count: auditCountBefore } = await service
      .from("audit_entries")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "account")
      .eq("entity_id", ids.accountId)
      .eq("action", "account.reassign_owner");

    const result = await reassignAccountPracticeOwner(client, session.actor, ids.accountId, ids.practiceLineId, ids.bdeBAuthId, TIMEZONE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { data: ownerRow } = await service
      .from("account_practice_owners")
      .select("owner_id")
      .eq("account_id", ids.accountId)
      .eq("practice_line_id", ids.practiceLineId)
      .single();
    expect(ownerRow?.owner_id).toBe(ids.bdeBAuthId);

    expect(result.handover.contacts.some((c) => c.contactId === ids.contactId)).toBe(true);
    expect(result.handover.openTasks.some((t) => t.id === ids.taskId)).toBe(true);

    const { data: auditRows, count: auditCountAfter } = await service
      .from("audit_entries")
      .select("action, actor_id", { count: "exact" })
      .eq("entity_type", "account")
      .eq("entity_id", ids.accountId)
      .eq("action", "account.reassign_owner")
      .order("occurred_at", { ascending: false })
      .limit(1);
    expect(auditCountAfter).toBe((auditCountBefore ?? 0) + 1);
    expect(auditRows?.[0]?.actor_id).toBe(ids.teamLeadAuthId);
  });
});
