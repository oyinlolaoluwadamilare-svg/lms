import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { dateInTimezone } from "@/lib/dates";
import { getSessionActor } from "@/services/actor";
import { logActivity } from "@/services/activities";
import { listActivitiesForDeal } from "@/data/activities";
import { getEngagementTimeline } from "@/services/engagementTimeline";
import { findOrCreateByUniqueMatch, findOrCreateTenant, findOrCreateUser, signIn as signInAs } from "./support/permanentFixture";

// M3.9 ⚑ exit criteria (docs/07-build-backlog.md): "Timezone test suite: an activity logged at
// 23:30 WAT renders the correct local date, and activity_date is never conflated with created_at
// in any response." docs/05-test-strategy.md's own "Time and locale tests" section names the exact
// shape: "every date-sensitive test runs against a user in Africa/Lagos AND a user in a
// negative-offset timezone... assert that an activity logged at 23:30 WAT shows the correct local
// date... activity_date and created_at are never conflated in any response."
//
// tests/unit/dates.spec.ts already proves this at the pure-function level (dateInTimezone,
// daysBetweenInTimezone, formatDateInTimezone all have a WAT-crossing-midnight case, plus a
// negative-offset counterpart). What was still missing, and what this file adds: an END-TO-END
// proof through the real service path (logActivity's actual accept/reject boundary, not just the
// underlying date-math primitive) against the real hosted project, in BOTH timezone directions,
// plus a dedicated regression test for the "never conflated with created_at" half of the invariant
// - nothing anywhere previously asserted that with a case where the two dates actually differ.
//
// `now` is passed as a fixed, safely-past historical instant (logActivity's own injectable `now`
// parameter, already used for exactly this kind of determinism) rather than the real wall clock -
// this is what lets the test assert an exact boundary crossing deterministically, rather than
// happening to catch (or miss) a real midnight while the suite runs.
//
// No e2e (Playwright) equivalent: this container's browser tests have no service-role credentials
// to control a precise clock/seed a precisely-timestamped row (the same documented limitation
// tests/e2e/pipeline.spec.ts's own comment already gives for why its coverage lives here instead).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M3-9-Integration-Test-Pw1!";

let service: SupabaseClient;

const ids = {
  tenantId: "",
  practiceLineId: "",
  stageId: "",
  accountId: "",
  bdeAuthId: "",
  dealId: "",
};

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

beforeAll(async () => {
  service = createServiceClient();

  ids.tenantId = await findOrCreateTenant(service, "m3-9-integration-test", "M3.9 Integration Test Tenant");

  ids.practiceLineId = await findOrCreateByUniqueMatch(
    service,
    "practice_lines",
    { tenant_id: ids.tenantId, code: "ADV" },
    { tenant_id: ids.tenantId, name: "Advisory", code: "ADV" },
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
    { tenant_id: ids.tenantId, name: "M3.9 Test Client" },
    { tenant_id: ids.tenantId, name: "M3.9 Test Client" },
  );

  ids.bdeAuthId = await findOrCreateUser(service, ids.tenantId, "m3-9-bde@example.com", "M3.9 Bde", PASSWORD);

  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  await service.from("user_roles").insert([
    { tenant_id: ids.tenantId, user_id: ids.bdeAuthId, role: "bde", practice_line_id: ids.practiceLineId },
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
    { tenant_id: ids.tenantId, reference: "D-TZ-1" },
    {
      tenant_id: ids.tenantId,
      reference: "D-TZ-1",
      name: "Timezone Test Deal",
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
  // Deliberately not deleting activities/the deal/account/stage/practice line/user - see this
  // file's header comment and every other activities-adjacent fixture's identical reasoning
  // (activities.deal_id is a real FK, no cascade; once one exists here, this deal can never be
  // deleted again). beforeAll is find-or-create for all of these.
});

describe("logActivity's future-date boundary shifts with the actor's own timezone, not UTC", () => {
  // 23:30 UTC on 14 June 2024 is already 00:30 on 15 June in Africa/Lagos (UTC+1) - CLAUDE.md #8's
  // own named example, and docs/07-build-backlog.md's exact wording. A UTC-based (buggy) "today"
  // would compute 14 June and reject 15 June as a future date; the correct WAT-based "today" is 15
  // June, so 15 June must be ACCEPTED. This is the sharpest form of the regression test: it proves
  // the accept/reject boundary itself moves with the timezone, not just that a stored value looks
  // right after the fact.
  it("accepts an activity_date that is 'tomorrow' in UTC but 'today' in Africa/Lagos (WAT, UTC+1)", async () => {
    const client = await signIn("m3-9-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const now = new Date("2024-06-14T23:30:00.000Z");
    const watToday = dateInTimezone(now.toISOString(), "Africa/Lagos");
    const utcToday = dateInTimezone(now.toISOString(), "UTC");
    expect(watToday).toBe("2024-06-15");
    expect(utcToday).toBe("2024-06-14");
    expect(watToday).not.toBe(utcToday); // the whole point: the two timezones disagree on "today" here

    const result = await logActivity(
      client,
      session.actor,
      "Africa/Lagos",
      {
        dealId: ids.dealId,
        type: "call",
        activityDate: watToday, // "today" in the actor's own timezone
        summary: "Logged right at the WAT midnight boundary",
        outcome: null,
        outcomeDisposition: null,
      },
      now,
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.activity.activityDate).toBe("2024-06-15");
  });

  // The mirror image, with a negative-offset zone, so this isn't coincidentally only correct for
  // positive offsets (docs/05-test-strategy.md's own "Africa/Lagos AND a negative-offset timezone"
  // pairing). 02:00 UTC on 15 June 2024 is still 19:00 on 14 June in America/Los_Angeles (UTC-7,
  // PDT in June) - here the actor's own "today" (14 June) is BEHIND UTC's date (15 June), so an
  // activityDate of 15 June must be REJECTED as a future date for this actor, even though it is
  // not in the future in UTC.
  it("rejects an activity_date that is 'today' in UTC but 'tomorrow' in America/Los_Angeles (UTC-7)", async () => {
    const client = await signIn("m3-9-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const now = new Date("2024-06-15T02:00:00.000Z");
    const laToday = dateInTimezone(now.toISOString(), "America/Los_Angeles");
    const utcToday = dateInTimezone(now.toISOString(), "UTC");
    expect(laToday).toBe("2024-06-14");
    expect(utcToday).toBe("2024-06-15");
    expect(laToday).not.toBe(utcToday);

    const result = await logActivity(
      client,
      session.actor,
      "America/Los_Angeles",
      {
        dealId: ids.dealId,
        type: "call",
        activityDate: utcToday, // "today" in UTC, but tomorrow for this LA-based actor
        summary: "Should be rejected - future for this actor's own timezone",
        outcome: null,
        outcomeDisposition: null,
      },
      now,
    );

    expect(result).toEqual({ ok: false, code: "activity_date_in_future" });
  });
});

// The other half of M3.9's own wording: "activity_date is never conflated with created_at in any
// response." Backdating the activity_date far from the real insert-time date (which the
// service-role client confirms independently below) makes the two genuinely different - a query
// that ever exposed created_at where activity_date was expected, or sorted/derived a date from
// created_at instead, would be caught here where a coincidentally-matching pair could not.
describe("activity_date is never conflated with created_at in any response", () => {
  it("a backdated activity's activityDate reflects activity_date everywhere, never created_at's real (much later) date", async () => {
    const client = await signIn("m3-9-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const backdatedDate = "2024-01-01"; // safely in the past under any timezone this test could run in
    const result = await logActivity(client, session.actor, "Africa/Lagos", {
      dealId: ids.dealId,
      type: "note",
      activityDate: backdatedDate,
      summary: "Backdated entry - activity_date and created_at must genuinely differ",
      outcome: null,
      outcomeDisposition: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Confirm the two dates really do differ before asserting anything is "never conflated" -
    // otherwise a coincidental match would make this whole test vacuous.
    const { data: rawRow } = await service.from("activities").select("activity_date, created_at").eq("id", result.activity.id).single();
    expect(rawRow?.activity_date).toBe(backdatedDate);
    const createdAtDate = dateInTimezone(rawRow!.created_at, "UTC");
    expect(createdAtDate).not.toBe(backdatedDate);

    // listActivitiesForDeal (src/data/activities.ts): the raw row-mapping layer every other
    // service reads through.
    const listed = await listActivitiesForDeal(client, ids.dealId);
    const listedEntry = listed.find((a) => a.id === result.activity.id);
    expect(listedEntry).toBeDefined();
    expect(listedEntry!.activityDate).toBe(backdatedDate);
    expect(listedEntry as unknown as Record<string, unknown>).not.toHaveProperty("createdAt");
    expect(listedEntry as unknown as Record<string, unknown>).not.toHaveProperty("created_at");

    // getEngagementTimeline (src/services/engagementTimeline.ts): the merged, UI-facing shape.
    const timeline = await getEngagementTimeline(client, ids.dealId);
    const timelineEntry = timeline.entries.find((e) => e.kind === "activity" && e.id === result.activity.id);
    expect(timelineEntry).toBeDefined();
    if (timelineEntry?.kind !== "activity") return;
    expect(timelineEntry.activityDate).toBe(backdatedDate);
    expect(timelineEntry as unknown as Record<string, unknown>).not.toHaveProperty("createdAt");
    expect(timelineEntry as unknown as Record<string, unknown>).not.toHaveProperty("created_at");
    // sortInstant is the one place a DATE and an instant are ever combined (noon-UTC-on-
    // activity_date, purely an internal ordering key - engagementTimeline.ts's own comment) - it
    // must still be derived from activity_date, never created_at.
    expect(timelineEntry.sortInstant).toBe(`${backdatedDate}T12:00:00.000Z`);
  });
});
