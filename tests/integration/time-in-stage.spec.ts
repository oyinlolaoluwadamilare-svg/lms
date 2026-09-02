import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSessionActor } from "@/services/actor";
import { getTimeInStage } from "@/services/reports";
import { findOrCreateByUniqueMatch, findOrCreateTenant, findOrCreateUser, signIn as signInAs } from "./support/permanentFixture";

// M6.3 exit criteria (docs/07-build-backlog.md): "Time in stage with median headline; bottleneck
// highlighting." Proves docs/04-metric-definitions.md's "Time in stage" end to end, against the real
// hosted project through real signed-in sessions: a bde is denied (analytics.view_practice, the
// same confirmed product-owner choice M6.2's Cohort funnel already uses); a team_lead sees only
// their own practice; the minimum-sample boundary (10 completed transits) is exercised exactly
// (Discovery clears it and reports a real median/mean, Proposal doesn't and reports
// insufficient_data); a reconstructed-only transit never counts; and a stage whose median exceeds
// its own configured bottleneck_threshold_days is flagged, while one below its threshold is not.
//
// deals and stage_events are both permanently un-deletable once seeded (forbid_mutation on
// stage_events, and a deal with a child stage_events row can't be deleted without violating that
// FK) - find-or-create throughout, the same reasoning tests/integration/cohort-funnel.spec.ts's own
// header comment already gives.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M6-3-Integration-Test-Pw1!";

let service: SupabaseClient;

const ids = {
  tenantId: "",
  practiceLineId: "",
  discoveryStageId: "",
  proposalStageId: "",
  wonStageId: "",
  accountId: "",
  bdeAuthId: "",
  teamLeadAuthId: "",
};

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

async function findOrCreateDeal(reference: string, stageId: string): Promise<string> {
  return findOrCreateByUniqueMatch(
    service,
    "deals",
    { tenant_id: ids.tenantId, reference },
    {
      tenant_id: ids.tenantId,
      reference,
      name: reference,
      account_id: ids.accountId,
      practice_line_id: ids.practiceLineId,
      stage_id: stageId,
      client_type: "new",
      owner_id: ids.teamLeadAuthId,
      author_id: ids.teamLeadAuthId,
      status: "active",
      expected_close_date: "2027-06-01",
    },
  );
}

// One stage_events row per (deal, fromStage->toStage) pair, matched on (deal_id, to_stage_id) the
// same way tests/integration/cohort-funnel.spec.ts's own findOrCreateStageEvent already does -
// duration_in_previous_seconds is left to the trigger (migration 0007), computed from the deal's
// own previous stage_events row or deals.created_at if none, so occurredAt spacing is what actually
// controls the resulting duration.
async function findOrCreateStageEvent(
  dealId: string,
  fromStageId: string | null,
  toStageId: string,
  occurredAt: string,
  isReconstructed = false,
): Promise<void> {
  const { data: existing } = await service.from("stage_events").select("id").eq("deal_id", dealId).eq("to_stage_id", toStageId).maybeSingle();
  if (existing) return;

  const { error } = await service.from("stage_events").insert({
    tenant_id: ids.tenantId,
    deal_id: dealId,
    from_stage_id: fromStageId,
    to_stage_id: toStageId,
    actor_id: ids.teamLeadAuthId,
    occurred_at: occurredAt,
    is_reconstructed: isReconstructed,
  });
  if (error) throw new Error(`seed stage_event for deal ${dealId} -> ${toStageId} failed: ${error.message}`);
}

beforeAll(async () => {
  service = createServiceClient();

  ids.tenantId = await findOrCreateTenant(service, "m6-3-time-in-stage-test", "M6.3 Time In Stage Test Tenant");
  ids.practiceLineId = await findOrCreateByUniqueMatch(
    service,
    "practice_lines",
    { tenant_id: ids.tenantId, code: "ADV" },
    { tenant_id: ids.tenantId, name: "Advisory", code: "ADV" },
  );
  ids.discoveryStageId = await findOrCreateByUniqueMatch(
    service,
    "pipeline_stages",
    { tenant_id: ids.tenantId, code: "DISCOVERY" },
    { tenant_id: ids.tenantId, name: "Discovery", code: "DISCOVERY", sort_order: 1, probability_threshold: 10, stage_type: "open" },
  );
  ids.proposalStageId = await findOrCreateByUniqueMatch(
    service,
    "pipeline_stages",
    { tenant_id: ids.tenantId, code: "PROPOSAL" },
    { tenant_id: ids.tenantId, name: "Proposal", code: "PROPOSAL", sort_order: 2, probability_threshold: 50, stage_type: "open" },
  );
  ids.wonStageId = await findOrCreateByUniqueMatch(
    service,
    "pipeline_stages",
    { tenant_id: ids.tenantId, code: "WON" },
    { tenant_id: ids.tenantId, name: "Won", code: "WON", sort_order: 3, probability_threshold: 100, stage_type: "won" },
  );
  ids.accountId = await findOrCreateByUniqueMatch(
    service,
    "accounts",
    { tenant_id: ids.tenantId, name: "M6.3 Time In Stage Test Client" },
    { tenant_id: ids.tenantId, name: "M6.3 Time In Stage Test Client" },
  );

  ids.bdeAuthId = await findOrCreateUser(service, ids.tenantId, "m6-3-tis-bde@example.com", "M6.3 TIS Bde", PASSWORD);
  ids.teamLeadAuthId = await findOrCreateUser(service, ids.tenantId, "m6-3-tis-team-lead@example.com", "M6.3 TIS Team Lead", PASSWORD);

  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  const { error: roleError } = await service.from("user_roles").insert([
    { tenant_id: ids.tenantId, user_id: ids.bdeAuthId, role: "bde", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.teamLeadAuthId, role: "team_lead", practice_line_id: ids.practiceLineId },
  ]);
  if (roleError) throw new Error(`fixture role grant failed: ${roleError.message}`);

  // Discovery: 10 deals depart Discovery for Proposal - exactly the doc's own minimum sample - each
  // spaced 2 days apart from a common creation instant, so the median/mean duration is a clean,
  // hand-computable 2/4/6/.../20 day sequence (median 11 days, mean 11 days).
  for (let i = 1; i <= 10; i += 1) {
    const reference = `D-6-3-TIS-${String(i).padStart(2, "0")}`;
    const dealId = await findOrCreateDeal(reference, ids.proposalStageId);
    const { data: dealRow } = await service.from("deals").select("created_at").eq("id", dealId).single();
    const createdAt = new Date(dealRow!.created_at as string);
    const enteredDiscoveryAt = createdAt.toISOString();
    const leftDiscoveryAt = new Date(createdAt.getTime() + i * 2 * 24 * 60 * 60 * 1000).toISOString();

    await findOrCreateStageEvent(dealId, null, ids.discoveryStageId, enteredDiscoveryAt);
    await findOrCreateStageEvent(dealId, ids.discoveryStageId, ids.proposalStageId, leftDiscoveryAt);
  }

  // A reconstructed-only Discovery departure - must never contribute to Discovery's own duration
  // set. If it leaked in, Discovery's sample size would read 11, not 10.
  const reconDealId = await findOrCreateDeal("D-6-3-TIS-RECON", ids.proposalStageId);
  await findOrCreateStageEvent(reconDealId, null, ids.discoveryStageId, "2026-01-01T00:00:00Z");
  await findOrCreateStageEvent(reconDealId, ids.discoveryStageId, ids.proposalStageId, "2026-01-02T00:00:00Z", true);

  // Proposal: only 3 deals ever depart Proposal (for Won) - below the minimum sample of 10, so this
  // boundary must read insufficient_data even though Discovery's own boundary clears it. Each is
  // created directly into Proposal (no Discovery step at all, from_stage_id null on its own first
  // row) - giving any of them a Discovery->Proposal transition instead would count as a Discovery
  // departure too (listStageDurationsForDeals groups by from_stage_id regardless of which deal it
  // belongs to), inflating Discovery's own controlled sample of exactly 10.
  for (let i = 1; i <= 3; i += 1) {
    const reference = `D-6-3-TIS-PROP-${i}`;
    const dealId = await findOrCreateDeal(reference, ids.wonStageId);
    await findOrCreateStageEvent(dealId, null, ids.proposalStageId, `2026-01-0${i}T00:00:00Z`);
    await findOrCreateStageEvent(dealId, ids.proposalStageId, ids.wonStageId, `2026-01-1${i}T00:00:00Z`);
  }
});

afterAll(async () => {
  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  await service.from("pipeline_stages").update({ bottleneck_threshold_days: null }).eq("id", ids.discoveryStageId);
});

describe("getTimeInStage, end to end against a real signed-in session", () => {
  it("a bde is denied entirely - analytics.view_practice has no scope for that role", async () => {
    const client = await signIn("m6-3-tis-bde@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await getTimeInStage(client, session.actor);
    expect(result).toEqual({ ok: false, code: "denied" });
  });

  it("a team_lead sees Discovery clear the minimum sample with the right median/mean, Proposal report insufficient_data, and the reconstructed transit never counted", async () => {
    const client = await signIn("m6-3-tis-team-lead@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await getTimeInStage(client, session.actor);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.scope).toBe("practice");

    const discovery = result.boundaries.find((b) => b.stageId === ids.discoveryStageId);
    expect(discovery?.durations.status).toBe("ok");
    if (discovery?.durations.status !== "ok") return;
    expect(discovery.durations.sampleSize).toBe(10); // not 11 - the reconstructed transit is excluded
    // Each departure's duration is measured against its own immediately-preceding stage_events row
    // (the entering-Discovery marker this fixture itself wrote), not deals.created_at, so this is
    // an exact integer number of seconds - 2,4,6,...,20 days, median and mean both exactly 11 days.
    const elevenDaysInSeconds = 11 * 24 * 60 * 60;
    expect(discovery.durations.value.medianSeconds).toBe(elevenDaysInSeconds);
    expect(discovery.durations.value.meanSeconds).toBe(elevenDaysInSeconds);

    const proposal = result.boundaries.find((b) => b.stageId === ids.proposalStageId);
    expect(proposal?.durations).toEqual({ status: "insufficient_data", sampleSize: 3, minimumRequired: 10 });
  });

  it("flags Discovery as a bottleneck once its threshold is set below the median, and clears once the threshold is raised above it", async () => {
    const client = await signIn("m6-3-tis-team-lead@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    await service.from("pipeline_stages").update({ bottleneck_threshold_days: 5 }).eq("id", ids.discoveryStageId);
    const flagged = await getTimeInStage(client, session.actor);
    expect(flagged.ok).toBe(true);
    if (!flagged.ok) return;
    expect(flagged.boundaries.find((b) => b.stageId === ids.discoveryStageId)?.isBottleneck).toBe(true);

    await service.from("pipeline_stages").update({ bottleneck_threshold_days: 30 }).eq("id", ids.discoveryStageId);
    const cleared = await getTimeInStage(client, session.actor);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.boundaries.find((b) => b.stageId === ids.discoveryStageId)?.isBottleneck).toBe(false);
  });
});
