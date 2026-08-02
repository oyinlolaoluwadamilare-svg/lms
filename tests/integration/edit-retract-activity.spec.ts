import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSessionActor } from "@/services/actor";
import { logActivity, retractActivity, updateActivity } from "@/services/activities";
import { dateInTimezone } from "@/lib/dates";
import { findOrCreateByUniqueMatch, findOrCreateTenant, findOrCreateUser, signIn as signInAs } from "./support/permanentFixture";

// M3.6 exit criteria (docs/07-build-backlog.md): "Edit within the 24-hour window with revision
// history and an 'edited' marker; retraction by Director or Admin with a mandatory reason, rendered
// struck through." Exercises the real chain against the real hosted project: real signed-in
// sessions, the real can() checks, the real activities_update RLS policy (author-only, within
// window) for updateActivity, and the real service-role bypass for retractActivity - the same shape
// tests/integration/log-activity.spec.ts already established for logActivity.
//
// activities has its own FK to deals (no cascade) - once one exists, this fixture's deal can never
// be deleted again, the same permanently-un-deletable chain every prior M3 integration fixture has
// already hit. Find-or-create for everything, never delete-and-recreate.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M3-6-Integration-Test-Pw1!";
const TIMEZONE = "Africa/Lagos";

let service: SupabaseClient;

const ids = {
  tenantId: "",
  practiceLineId: "",
  otherPracticeLineId: "",
  stageId: "",
  accountId: "",
  bdeAuthId: "",
  otherBdeAuthId: "",
  directorAuthId: "",
  otherPracticeDirectorAuthId: "",
  dealId: "",
};

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

async function logTestActivity(client: SupabaseClient, actor: Awaited<ReturnType<typeof getSessionActor>>, dealId: string, summary: string) {
  if (actor.status !== "active") throw new Error("expected an active session");
  const result = await logActivity(client, actor.actor, TIMEZONE, {
    dealId,
    type: "note",
    activityDate: dateInTimezone(new Date().toISOString(), TIMEZONE),
    summary,
    outcome: null,
    outcomeDisposition: null,
  });
  if (!result.ok) throw new Error(`fixture logActivity failed: ${result.code}`);
  return result.activity;
}

beforeAll(async () => {
  service = createServiceClient();

  ids.tenantId = await findOrCreateTenant(service, "m3-6-integration-test", "M3.6 Integration Test Tenant");

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
    { tenant_id: ids.tenantId, name: "M3.6 Test Client" },
    { tenant_id: ids.tenantId, name: "M3.6 Test Client" },
  );

  ids.bdeAuthId = await findOrCreateUser(service, ids.tenantId, "m3-6-bde@example.com", "M3.6 Bde", PASSWORD);
  ids.otherBdeAuthId = await findOrCreateUser(service, ids.tenantId, "m3-6-bde-other@example.com", "M3.6 Other Bde", PASSWORD);
  ids.directorAuthId = await findOrCreateUser(service, ids.tenantId, "m3-6-director@example.com", "M3.6 Director", PASSWORD);
  ids.otherPracticeDirectorAuthId = await findOrCreateUser(
    service,
    ids.tenantId,
    "m3-6-director-other-practice@example.com",
    "M3.6 Director Other Practice",
    PASSWORD,
  );

  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  await service.from("user_roles").insert([
    { tenant_id: ids.tenantId, user_id: ids.bdeAuthId, role: "bde", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.otherBdeAuthId, role: "bde", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.directorAuthId, role: "director", practice_line_id: ids.practiceLineId },
    {
      tenant_id: ids.tenantId,
      user_id: ids.otherPracticeDirectorAuthId,
      role: "director",
      practice_line_id: ids.otherPracticeLineId,
    },
  ]);

  // D-03: accounts_select needs an account_practice_owners row (migration 0005) - see
  // log-activity.spec.ts's own comment for how this gap was originally found via manual QA.
  await service.from("account_practice_owners").delete().eq("account_id", ids.accountId);
  await service
    .from("account_practice_owners")
    .insert({ account_id: ids.accountId, practice_line_id: ids.practiceLineId, owner_id: ids.bdeAuthId });

  ids.dealId = await findOrCreateByUniqueMatch(
    service,
    "deals",
    { tenant_id: ids.tenantId, reference: "D-EDITRETRACT-1" },
    {
      tenant_id: ids.tenantId,
      reference: "D-EDITRETRACT-1",
      name: "Edit/Retract Activity Test Deal",
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
});

afterAll(async () => {
  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  // Deliberately not deleting activities/activity_revisions/the deal/account/stage/practice
  // lines/users/tenant - see this file's header comment. beforeAll is find-or-create for all of
  // these.
});

describe("updateActivity, end to end against a real signed-in session", () => {
  it("the author can edit their own activity within the window; one revision row per changed field, and one audit row", async () => {
    const client = await signIn("m3-6-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const activity = await logTestActivity(client, session, ids.dealId, "Original summary for edit test");

    const { count: auditBefore } = await service
      .from("audit_entries")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "activity")
      .eq("action", "activity.update");

    const result = await updateActivity(client, session.actor, activity.id, {
      type: "call",
      activityDate: activity.activityDate,
      summary: "Edited summary for edit test",
      outcome: "Now has an outcome",
      outcomeDisposition: "positive",
    });
    expect(result).toEqual({ ok: true });

    const { data: row } = await service
      .from("activities")
      .select("type, summary, outcome, outcome_disposition")
      .eq("id", activity.id)
      .single();
    expect(row).toMatchObject({ type: "call", summary: "Edited summary for edit test", outcome: "Now has an outcome", outcome_disposition: "positive" });

    const { data: revisions } = await service.from("activity_revisions").select("field_name, previous_value, new_value").eq("activity_id", activity.id);
    const fieldNames = (revisions ?? []).map((r) => r.field_name).sort();
    expect(fieldNames).toEqual(["outcome", "outcomeDisposition", "summary", "type"].sort());

    const { count: auditAfter } = await service
      .from("audit_entries")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "activity")
      .eq("action", "activity.update");
    expect(auditAfter).toBe((auditBefore ?? 0) + 1);
  });

  it("editing with no actual field changes writes no revision and no audit row", async () => {
    const client = await signIn("m3-6-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const activity = await logTestActivity(client, session, ids.dealId, "Untouched summary");

    const { count: revisionsBefore } = await service
      .from("activity_revisions")
      .select("id", { count: "exact", head: true })
      .eq("activity_id", activity.id);

    const result = await updateActivity(client, session.actor, activity.id, {
      type: "note",
      activityDate: activity.activityDate,
      summary: "Untouched summary",
      outcome: null,
      outcomeDisposition: null,
    });
    expect(result).toEqual({ ok: true });

    const { count: revisionsAfter } = await service
      .from("activity_revisions")
      .select("id", { count: "exact", head: true })
      .eq("activity_id", activity.id);
    expect(revisionsAfter).toBe(revisionsBefore ?? 0);
  });

  it("a practice peer who did not author the activity is denied - 'own' has no practice-wide override", async () => {
    const authorClient = await signIn("m3-6-bde@example.com");
    const authorSession = await getSessionActor(authorClient);
    expect(authorSession.status).toBe("active");
    if (authorSession.status !== "active") return;
    const activity = await logTestActivity(authorClient, authorSession, ids.dealId, "Authored by bde, not to be hijacked");

    const otherClient = await signIn("m3-6-bde-other@example.com");
    const otherSession = await getSessionActor(otherClient);
    expect(otherSession.status).toBe("active");
    if (otherSession.status !== "active") return;

    const result = await updateActivity(otherClient, otherSession.actor, activity.id, {
      type: "note",
      activityDate: activity.activityDate,
      summary: "Hijacked summary",
      outcome: null,
      outcomeDisposition: null,
    });
    expect(result).toEqual({ ok: false, code: "denied" });
  });

  it("a director (even with retract rights) is denied editing someone else's activity - update is author-only, not practice-scoped", async () => {
    const authorClient = await signIn("m3-6-bde@example.com");
    const authorSession = await getSessionActor(authorClient);
    expect(authorSession.status).toBe("active");
    if (authorSession.status !== "active") return;
    const activity = await logTestActivity(authorClient, authorSession, ids.dealId, "Authored by bde, director cannot edit");

    const directorClient = await signIn("m3-6-director@example.com");
    const directorSession = await getSessionActor(directorClient);
    expect(directorSession.status).toBe("active");
    if (directorSession.status !== "active") return;

    const result = await updateActivity(directorClient, directorSession.actor, activity.id, {
      type: "note",
      activityDate: activity.activityDate,
      summary: "Director should not be able to do this",
      outcome: null,
      outcomeDisposition: null,
    });
    expect(result).toEqual({ ok: false, code: "denied" });
  });

  it("the edit window has closed - edit_window_expired, not a silent no-op", async () => {
    const client = await signIn("m3-6-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const { data: inserted } = await service
      .from("activities")
      .insert({
        tenant_id: ids.tenantId,
        deal_id: ids.dealId,
        type: "note",
        activity_date: dateInTimezone(new Date().toISOString(), TIMEZONE),
        summary: "Already outside the window",
        author_id: ids.bdeAuthId,
        edit_locked_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      })
      .select("id, activity_date")
      .single();

    const result = await updateActivity(client, session.actor, inserted!.id, {
      type: "note",
      activityDate: inserted!.activity_date,
      summary: "Too late to edit",
      outcome: null,
      outcomeDisposition: null,
    });
    expect(result).toEqual({ ok: false, code: "edit_window_expired" });
  });

  it("a retracted activity cannot be edited, even by its own author within the window", async () => {
    const client = await signIn("m3-6-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;
    const activity = await logTestActivity(client, session, ids.dealId, "About to be retracted then edited");

    const directorClient = await signIn("m3-6-director@example.com");
    const directorSession = await getSessionActor(directorClient);
    expect(directorSession.status).toBe("active");
    if (directorSession.status !== "active") return;
    const retraction = await retractActivity(directorClient, directorSession.actor, activity.id, "Test retraction before edit attempt");
    expect(retraction).toEqual({ ok: true });

    const result = await updateActivity(client, session.actor, activity.id, {
      type: "note",
      activityDate: activity.activityDate,
      summary: "Should never be applied",
      outcome: null,
      outcomeDisposition: null,
    });
    expect(result).toEqual({ ok: false, code: "retracted" });
  });
});

describe("retractActivity, end to end against a real signed-in session", () => {
  it("a director retracts a practice member's activity: retracted_at/by/reason are set and exactly one audit row is written", async () => {
    const authorClient = await signIn("m3-6-bde@example.com");
    const authorSession = await getSessionActor(authorClient);
    expect(authorSession.status).toBe("active");
    if (authorSession.status !== "active") return;
    const activity = await logTestActivity(authorClient, authorSession, ids.dealId, "To be retracted by director");

    const { count: auditBefore } = await service
      .from("audit_entries")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "activity")
      .eq("action", "activity.retract");

    const directorClient = await signIn("m3-6-director@example.com");
    const directorSession = await getSessionActor(directorClient);
    expect(directorSession.status).toBe("active");
    if (directorSession.status !== "active") return;

    const result = await retractActivity(directorClient, directorSession.actor, activity.id, "Duplicate entry, logged in error");
    expect(result).toEqual({ ok: true });

    const { data: row } = await service.from("activities").select("retracted_at, retracted_by, retraction_reason").eq("id", activity.id).single();
    expect(row?.retracted_at).not.toBeNull();
    expect(row?.retracted_by).toBe(ids.directorAuthId);
    expect(row?.retraction_reason).toBe("Duplicate entry, logged in error");

    const { count: auditAfter } = await service
      .from("audit_entries")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "activity")
      .eq("action", "activity.retract");
    expect(auditAfter).toBe((auditBefore ?? 0) + 1);
  });

  it("the author themself (a bde) cannot retract their own activity - retraction is director/admin only", async () => {
    const client = await signIn("m3-6-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;
    const activity = await logTestActivity(client, session, ids.dealId, "Author tries to self-retract");

    const result = await retractActivity(client, session.actor, activity.id, "I want to take this back myself");
    expect(result).toEqual({ ok: false, code: "denied" });
  });

  it("a director outside the deal's practice line can't even see the activity - not_found, same as every other cross-practice case", async () => {
    const authorClient = await signIn("m3-6-bde@example.com");
    const authorSession = await getSessionActor(authorClient);
    expect(authorSession.status).toBe("active");
    if (authorSession.status !== "active") return;
    const activity = await logTestActivity(authorClient, authorSession, ids.dealId, "Outside-practice director cannot retract this");

    const client = await signIn("m3-6-director-other-practice@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    // getActivityForAuthorization reads through the caller's OWN RLS-scoped session
    // (activities_select, migration 0008) - practice-scoped, so this activity is invisible to a
    // director in a different practice line before can() is ever reached, the same "not_found
    // before denied" convention tests/integration/log-activity.spec.ts's own cross-practice case
    // already established for logActivity.
    const result = await retractActivity(client, session.actor, activity.id, "Should never resolve to ok");
    expect(result).toEqual({ ok: false, code: "not_found" });
  });

  it("a blank reason is rejected before any write - reason_required", async () => {
    const authorClient = await signIn("m3-6-bde@example.com");
    const authorSession = await getSessionActor(authorClient);
    expect(authorSession.status).toBe("active");
    if (authorSession.status !== "active") return;
    const activity = await logTestActivity(authorClient, authorSession, ids.dealId, "Retraction reason must not be blank");

    const directorClient = await signIn("m3-6-director@example.com");
    const directorSession = await getSessionActor(directorClient);
    expect(directorSession.status).toBe("active");
    if (directorSession.status !== "active") return;

    const result = await retractActivity(directorClient, directorSession.actor, activity.id, "   ");
    expect(result).toEqual({ ok: false, code: "reason_required" });

    const { data: row } = await service.from("activities").select("retracted_at").eq("id", activity.id).single();
    expect(row?.retracted_at).toBeNull();
  });

  it("an already-retracted activity cannot be retracted again", async () => {
    const authorClient = await signIn("m3-6-bde@example.com");
    const authorSession = await getSessionActor(authorClient);
    expect(authorSession.status).toBe("active");
    if (authorSession.status !== "active") return;
    const activity = await logTestActivity(authorClient, authorSession, ids.dealId, "Retracted twice, the second time should fail");

    const directorClient = await signIn("m3-6-director@example.com");
    const directorSession = await getSessionActor(directorClient);
    expect(directorSession.status).toBe("active");
    if (directorSession.status !== "active") return;

    const first = await retractActivity(directorClient, directorSession.actor, activity.id, "First retraction");
    expect(first).toEqual({ ok: true });

    const second = await retractActivity(directorClient, directorSession.actor, activity.id, "Second retraction attempt");
    expect(second).toEqual({ ok: false, code: "already_retracted" });
  });
});
