import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSessionActor } from "@/services/actor";
import { getCohortConversionFunnel } from "@/services/reports";
import { findOrCreateByUniqueMatch, findOrCreateTenant, findOrCreateUser, signIn as signInAs } from "./support/permanentFixture";

// M6.2 exit criteria (docs/07-build-backlog.md): "Cohort conversion funnel; remove any current-state
// approximation." Proves docs/04-metric-definitions.md's "Stage-to-stage conversion rate" end to
// end, against the real hosted project through real signed-in sessions: a bde is denied outright
// (analytics.view_practice, a confirmed product-owner choice - see this file's own header comment
// in src/services/reports.ts); a team_lead sees only their own practice's cohort; an executive sees
// tenant-wide, both practices summed; the minimum-sample boundary (20 deals) is exercised exactly
// (Discovery's cohort of 20 reports a real rate, Proposal's cohort of 12 reports insufficient_data);
// and a reconstructed-only stage_events row never contributes to any cohort (D-16).
//
// deals and stage_events are both permanently un-deletable once seeded here - stage_events is
// append-only by forbid_mutation() (migration 0007), and a deal with a child stage_events row can't
// be deleted without violating that FK - so this fixture is find-or-create throughout, never
// delete-and-recreate, the same reasoning tests/integration/handover.spec.ts's own afterAll comment
// already gives for activities/tasks/deal_contacts.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M6-2-Integration-Test-Pw1!";

let service: SupabaseClient;

const ids = {
  tenantId: "",
  practiceAdvId: "",
  practiceEsId: "",
  discoveryStageId: "",
  proposalStageId: "",
  wonStageId: "",
  lostStageId: "",
  accountId: "",
  bdeAuthId: "",
  teamLeadAuthId: "",
  executiveAuthId: "",
};

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

async function findOrCreateDeal(reference: string, practiceLineId: string, stageId: string): Promise<string> {
  return findOrCreateByUniqueMatch(
    service,
    "deals",
    { tenant_id: ids.tenantId, reference },
    {
      tenant_id: ids.tenantId,
      reference,
      name: reference,
      account_id: ids.accountId,
      practice_line_id: practiceLineId,
      stage_id: stageId,
      client_type: "new",
      owner_id: ids.teamLeadAuthId,
      author_id: ids.teamLeadAuthId,
      status: "active",
      expected_close_date: "2027-06-01",
    },
  );
}

async function findOrCreateStageEvent(dealId: string, toStageId: string, occurredAt: string, isReconstructed = false): Promise<void> {
  const { data: existing } = await service.from("stage_events").select("id").eq("deal_id", dealId).eq("to_stage_id", toStageId).maybeSingle();
  if (existing) return;

  const { error } = await service.from("stage_events").insert({
    tenant_id: ids.tenantId,
    deal_id: dealId,
    from_stage_id: null,
    to_stage_id: toStageId,
    actor_id: ids.teamLeadAuthId,
    occurred_at: occurredAt,
    is_reconstructed: isReconstructed,
  });
  if (error) throw new Error(`seed stage_event for deal ${dealId} -> ${toStageId} failed: ${error.message}`);
}

beforeAll(async () => {
  service = createServiceClient();

  ids.tenantId = await findOrCreateTenant(service, "m6-2-integration-test", "M6.2 Integration Test Tenant");
  ids.practiceAdvId = await findOrCreateByUniqueMatch(
    service,
    "practice_lines",
    { tenant_id: ids.tenantId, code: "ADV" },
    { tenant_id: ids.tenantId, name: "Advisory", code: "ADV" },
  );
  ids.practiceEsId = await findOrCreateByUniqueMatch(
    service,
    "practice_lines",
    { tenant_id: ids.tenantId, code: "ES" },
    { tenant_id: ids.tenantId, name: "Executive Search", code: "ES" },
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
  ids.lostStageId = await findOrCreateByUniqueMatch(
    service,
    "pipeline_stages",
    { tenant_id: ids.tenantId, code: "LOST" },
    { tenant_id: ids.tenantId, name: "Lost", code: "LOST", sort_order: 4, probability_threshold: 0, stage_type: "lost" },
  );
  ids.accountId = await findOrCreateByUniqueMatch(
    service,
    "accounts",
    { tenant_id: ids.tenantId, name: "M6.2 Test Client" },
    { tenant_id: ids.tenantId, name: "M6.2 Test Client" },
  );

  ids.bdeAuthId = await findOrCreateUser(service, ids.tenantId, "m6-2-bde@example.com", "M6.2 Bde", PASSWORD);
  ids.teamLeadAuthId = await findOrCreateUser(service, ids.tenantId, "m6-2-team-lead@example.com", "M6.2 Team Lead", PASSWORD);
  ids.executiveAuthId = await findOrCreateUser(service, ids.tenantId, "m6-2-executive@example.com", "M6.2 Executive", PASSWORD);

  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  const { error: roleError } = await service.from("user_roles").insert([
    { tenant_id: ids.tenantId, user_id: ids.bdeAuthId, role: "bde", practice_line_id: ids.practiceAdvId },
    { tenant_id: ids.tenantId, user_id: ids.teamLeadAuthId, role: "team_lead", practice_line_id: ids.practiceAdvId },
    { tenant_id: ids.tenantId, user_id: ids.executiveAuthId, role: "executive", practice_line_id: null },
  ]);
  if (roleError) throw new Error(`fixture role grant failed: ${roleError.message}`);

  // Advisory: 20 deals enter Discovery - exactly the doc's own minimum sample, chosen deliberately
  // so this boundary reports a real rate, not insufficient_data. 12 of them (01-12) subsequently
  // enter Proposal too; 13-20 never advance.
  for (let i = 1; i <= 20; i += 1) {
    const reference = `D-6-2-ADV-${String(i).padStart(2, "0")}`;
    const advances = i <= 12;
    const dealId = await findOrCreateDeal(reference, ids.practiceAdvId, advances ? ids.proposalStageId : ids.discoveryStageId);
    await findOrCreateStageEvent(dealId, ids.discoveryStageId, `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`);
    if (advances) {
      await findOrCreateStageEvent(dealId, ids.proposalStageId, `2026-02-01T00:00:${String(i).padStart(2, "0")}Z`);
    }
  }

  // A reconstructed-only entry into Discovery (D-16: excluded from the cohort entirely) - if this
  // ever leaked in, Discovery's own cohort would read 21, not 20, and this test would catch it.
  const reconDealId = await findOrCreateDeal("D-6-2-ADV-RECON", ids.practiceAdvId, ids.discoveryStageId);
  await findOrCreateStageEvent(reconDealId, ids.discoveryStageId, "2026-01-01T00:00:00Z", true);

  // Executive Search: 3 more deals entering Discovery, none of which ever advance - out of the
  // Advisory team_lead's own scope, but folded into the executive's tenant-wide cohort.
  for (let i = 1; i <= 3; i += 1) {
    const reference = `D-6-2-ES-${String(i).padStart(2, "0")}`;
    const dealId = await findOrCreateDeal(reference, ids.practiceEsId, ids.discoveryStageId);
    await findOrCreateStageEvent(dealId, ids.discoveryStageId, `2026-01-01T01:00:${String(i).padStart(2, "0")}Z`);
  }
});

afterAll(async () => {
  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
});

describe("getCohortConversionFunnel, end to end against a real signed-in session", () => {
  it("a bde is denied entirely - analytics.view_practice has no scope for that role", async () => {
    const client = await signIn("m6-2-bde@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await getCohortConversionFunnel(client, session.actor);
    expect(result).toEqual({ ok: false, code: "denied" });
  });

  it("a team_lead sees only their own practice's cohort: Discovery clears the minimum sample, Proposal doesn't, and the reconstructed row never counts", async () => {
    const client = await signIn("m6-2-team-lead@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await getCohortConversionFunnel(client, session.actor);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.scope).toBe("practice");
    expect(result.boundaries).toHaveLength(2); // only the two 'open' stages - Won/Lost are never a boundary's own N

    const discovery = result.boundaries.find((b) => b.stageId === ids.discoveryStageId);
    expect(discovery?.cohortSize).toBe(20); // the reconstructed row (D-16) does not make this 21
    expect(discovery?.advancedCount).toBe(12);
    expect(discovery?.conversionRate).toEqual({ status: "ok", value: 0.6, sampleSize: 20 });

    const proposal = result.boundaries.find((b) => b.stageId === ids.proposalStageId);
    expect(proposal?.cohortSize).toBe(12);
    expect(proposal?.advancedCount).toBe(0); // none of these 12 have gone on to Won/Lost in this fixture
    expect(proposal?.conversionRate).toEqual({ status: "insufficient_data", sampleSize: 12, minimumRequired: 20 });
  });

  it("an executive sees tenant-wide: both practices' Discovery cohorts summed, Advisory's own advancement unaffected by Executive Search's non-advancers", async () => {
    const client = await signIn("m6-2-executive@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await getCohortConversionFunnel(client, session.actor);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.scope).toBe("tenant");

    const discovery = result.boundaries.find((b) => b.stageId === ids.discoveryStageId);
    expect(discovery?.cohortSize).toBe(23); // 20 Advisory + 3 Executive Search
    expect(discovery?.advancedCount).toBe(12); // only Advisory's own 12 ever reached Proposal
    expect(discovery?.conversionRate).toEqual({ status: "ok", value: 12 / 23, sampleSize: 23 });
  });
});
