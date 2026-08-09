import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSessionActor } from "@/services/actor";
import { closeDeal } from "@/services/deals";
import { findOrCreateByUniqueMatch, findOrCreateTenant, findOrCreateUser, signIn as signInAs } from "./support/permanentFixture";

// M5.2 exit criteria (docs/07-build-backlog.md): "`closeDeal` service: atomic outcome, stage event,
// status, open-task cancellation, audit. Closing is impossible without a reason; loss requires
// detail; lost-to-competitor requires a name." Proves the entire real chain against the real hosted
// project: a real Supabase Auth sign-in, the real RLS-scoped session client, the real can() check,
// and the real close_deal RPC (migration 0017) - tests/rls/closeDeal.spec.ts already proves the RPC
// itself is atomic and its rejections roll back cleanly; this proves closeDeal's own TS-layer
// pre-validation (denial, already-closed, reason mismatch, loss-detail, competitor-name) produces
// the clean result codes it promises, and that a successful call really does persist through RLS.
//
// closeDeal's own RPC call writes a stage_events row on every success, and stage_events is
// immutable for every role including service_role (migration 0007's forbid_mutation trigger) with a
// real FK to deals(id) - so once a deal here is successfully closed, that deal (and the account/
// practice line/stage it references) is permanently un-deletable, the same problem
// tests/integration/pipeline-list.spec.ts's own header comment already documents for changeStage.
// This fixture is find-or-create for every deal, and beforeAll resets each one's mutable fields
// (status/stage_id/actual_close_date) plus deletes any leftover deal_outcomes row (deal_outcomes
// carries no such trigger, so service_role can delete it) so the suite is idempotent across reruns.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M5-2-Integration-Test-Pw1!";

let service: SupabaseClient;

const ids = {
  tenantId: "",
  practiceLineId: "",
  openStageId: "",
  wonStageId: "",
  lostStageId: "",
  accountId: "",
  bdeAuthId: "",
  executiveAuthId: "",
  winReasonId: "",
  lossReasonId: "",
  competitorReasonId: "",
  dealWinId: "",
  dealLossId: "",
  dealDeniedId: "",
  dealAlreadyClosedId: "",
  dealReasonMismatchId: "",
  dealMissingDetailId: "",
  dealMissingCompetitorId: "",
};

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

async function findOrCreateDeal(reference: string, name: string): Promise<string> {
  const id = await findOrCreateByUniqueMatch(
    service,
    "deals",
    { tenant_id: ids.tenantId, reference },
    {
      tenant_id: ids.tenantId,
      reference,
      name,
      account_id: ids.accountId,
      practice_line_id: ids.practiceLineId,
      stage_id: ids.openStageId,
      client_type: "new",
      owner_id: ids.bdeAuthId,
      author_id: ids.bdeAuthId,
      status: "active",
      expected_close_date: "2027-03-01",
    },
  );

  const { error } = await service
    .from("deals")
    .update({ status: "active", stage_id: ids.openStageId, actual_close_date: null })
    .eq("id", id);
  if (error) throw new Error(`reset deal ${reference} failed: ${error.message}`);
  await service.from("deal_outcomes").delete().eq("deal_id", id);
  await service.from("tasks").delete().eq("deal_id", id);

  return id;
}

beforeAll(async () => {
  service = createServiceClient();

  ids.tenantId = await findOrCreateTenant(service, "m5-2-integration-test", "M5.2 Integration Test Tenant");

  ids.practiceLineId = await findOrCreateByUniqueMatch(
    service,
    "practice_lines",
    { tenant_id: ids.tenantId, code: "ADV" },
    { tenant_id: ids.tenantId, name: "Advisory", code: "ADV" },
  );

  ids.openStageId = await findOrCreateByUniqueMatch(
    service,
    "pipeline_stages",
    { tenant_id: ids.tenantId, code: "DISCOVERY" },
    { tenant_id: ids.tenantId, name: "Discovery", code: "DISCOVERY", sort_order: 1, probability_threshold: 20, stage_type: "open" },
  );
  ids.wonStageId = await findOrCreateByUniqueMatch(
    service,
    "pipeline_stages",
    { tenant_id: ids.tenantId, code: "WON" },
    { tenant_id: ids.tenantId, name: "Closed Won", code: "WON", sort_order: 90, probability_threshold: 100, stage_type: "won" },
  );
  ids.lostStageId = await findOrCreateByUniqueMatch(
    service,
    "pipeline_stages",
    { tenant_id: ids.tenantId, code: "LOST" },
    { tenant_id: ids.tenantId, name: "Closed Lost", code: "LOST", sort_order: 91, probability_threshold: 0, stage_type: "lost" },
  );

  ids.accountId = await findOrCreateByUniqueMatch(
    service,
    "accounts",
    { tenant_id: ids.tenantId, name: "M5.2 Test Client" },
    { tenant_id: ids.tenantId, name: "M5.2 Test Client" },
  );

  ids.bdeAuthId = await findOrCreateUser(service, ids.tenantId, "m5-2-bde@example.com", "M5.2 Bde", PASSWORD);
  ids.executiveAuthId = await findOrCreateUser(service, ids.tenantId, "m5-2-executive@example.com", "M5.2 Executive", PASSWORD);

  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  const { error: roleError } = await service.from("user_roles").insert([
    { tenant_id: ids.tenantId, user_id: ids.bdeAuthId, role: "bde", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.executiveAuthId, role: "executive", practice_line_id: null },
  ]);
  if (roleError) throw new Error(`fixture role grant failed: ${roleError.message}`);

  ids.winReasonId = await findOrCreateByUniqueMatch(
    service,
    "outcome_reasons",
    { tenant_id: ids.tenantId, type: "win", label: "Best fit" },
    { tenant_id: ids.tenantId, type: "win", label: "Best fit", requires_competitor_name: false },
  );
  ids.lossReasonId = await findOrCreateByUniqueMatch(
    service,
    "outcome_reasons",
    { tenant_id: ids.tenantId, type: "loss", label: "Budget cut" },
    { tenant_id: ids.tenantId, type: "loss", label: "Budget cut", requires_competitor_name: false },
  );
  ids.competitorReasonId = await findOrCreateByUniqueMatch(
    service,
    "outcome_reasons",
    { tenant_id: ids.tenantId, type: "loss", label: "Lost to competitor" },
    { tenant_id: ids.tenantId, type: "loss", label: "Lost to competitor", requires_competitor_name: true },
  );

  ids.dealWinId = await findOrCreateDeal("D-5-2-WIN", "Win path deal");
  ids.dealLossId = await findOrCreateDeal("D-5-2-LOSS", "Loss path deal");
  ids.dealDeniedId = await findOrCreateDeal("D-5-2-DENIED", "Executive-denied deal");
  ids.dealAlreadyClosedId = await findOrCreateDeal("D-5-2-ALREADY", "Already-closed deal");
  ids.dealReasonMismatchId = await findOrCreateDeal("D-5-2-MISMATCH", "Reason-mismatch deal");
  ids.dealMissingDetailId = await findOrCreateDeal("D-5-2-NO-DETAIL", "Missing-detail deal");
  ids.dealMissingCompetitorId = await findOrCreateDeal("D-5-2-NO-COMPETITOR", "Missing-competitor deal");
});

afterAll(async () => {
  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  // Deals/stages/accounts/practice lines/outcome reasons are all permanently un-deletable once a
  // successful close writes a stage_events row against them (see this file's header comment) - not
  // deleted here, same reasoning as pipeline-list.spec.ts's own afterAll.
});

describe("closeDeal, end to end against a real signed-in session and the real hosted project", () => {
  it("a bde closes their own deal as won: atomic write, task cancellation, audit", async () => {
    const { data: task, error: taskError } = await service
      .from("tasks")
      .insert({
        tenant_id: ids.tenantId,
        deal_id: ids.dealWinId,
        title: "Open task",
        status: "open",
        due_date: "2027-01-01",
        assignee_id: ids.bdeAuthId,
        assigned_by: ids.bdeAuthId,
      })
      .select("id")
      .single();
    if (taskError) throw new Error(`seed task failed: ${taskError.message}`);

    const client = await signIn("m5-2-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    // Delta, not exact-length: dealWinId is a find-or-create/reset fixture (see this file's header
    // comment), so its stage_events/audit_entries history correctly accumulates across every real
    // run of this suite against the hosted project (CLAUDE.md #4's append-only rule), the same
    // reasoning tests/integration/pipeline-list.spec.ts's own changeStage assertions already use.
    const { count: auditCountBefore } = await service
      .from("audit_entries")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "deal")
      .eq("entity_id", ids.dealWinId)
      .eq("action", "deal.mark_won");

    const result = await closeDeal(client, session.actor, ids.dealWinId, {
      result: "win",
      reasonId: ids.winReasonId,
      reasonDetail: null,
      competitorName: null,
      finalValueMinor: 1_200_000n,
      currencyCode: "NGN",
      actualCloseDate: "2027-02-01",
    });

    expect(result).toEqual({ ok: true });

    const { data: dealRow } = await service.from("deals").select("status, stage_id, actual_close_date").eq("id", ids.dealWinId).single();
    expect(dealRow?.status).toBe("won");
    expect(dealRow?.stage_id).toBe(ids.wonStageId);
    expect(dealRow?.actual_close_date).toBe("2027-02-01");

    const { data: outcomeRow } = await service
      .from("deal_outcomes")
      .select("result, reason_id, final_value_minor::text, closed_by")
      .eq("deal_id", ids.dealWinId)
      .single();
    expect(outcomeRow?.result).toBe("win");
    expect(outcomeRow?.reason_id).toBe(ids.winReasonId);
    expect(outcomeRow?.final_value_minor).toBe("1200000");
    expect(outcomeRow?.closed_by).toBe(ids.bdeAuthId);

    const { data: taskRow } = await service.from("tasks").select("status").eq("id", task!.id).single();
    expect(taskRow?.status).toBe("cancelled");

    const { data: auditRows, count: auditCountAfter } = await service
      .from("audit_entries")
      .select("action, actor_id", { count: "exact" })
      .eq("entity_type", "deal")
      .eq("entity_id", ids.dealWinId)
      .eq("action", "deal.mark_won")
      .order("occurred_at", { ascending: false })
      .limit(1);
    expect(auditCountAfter).toBe((auditCountBefore ?? 0) + 1);
    expect(auditRows?.[0]?.actor_id).toBe(ids.bdeAuthId);
  });

  it("a bde closes their own deal as lost, with a required detail", async () => {
    const client = await signIn("m5-2-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await closeDeal(client, session.actor, ids.dealLossId, {
      result: "loss",
      reasonId: ids.lossReasonId,
      reasonDetail: "Client cut the budget mid-cycle",
      competitorName: null,
      finalValueMinor: null,
      currencyCode: null,
      actualCloseDate: "2027-02-01",
    });

    expect(result).toEqual({ ok: true });

    const { data: dealRow } = await service.from("deals").select("status, stage_id").eq("id", ids.dealLossId).single();
    expect(dealRow?.status).toBe("lost");
    expect(dealRow?.stage_id).toBe(ids.lostStageId);
  });

  it("an executive is denied before any write is attempted", async () => {
    const client = await signIn("m5-2-executive@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await closeDeal(client, session.actor, ids.dealDeniedId, {
      result: "win",
      reasonId: ids.winReasonId,
      reasonDetail: null,
      competitorName: null,
      finalValueMinor: null,
      currencyCode: null,
      actualCloseDate: "2027-02-01",
    });

    expect(result).toEqual({ ok: false, code: "denied" });

    const { data: dealRow } = await service.from("deals").select("status").eq("id", ids.dealDeniedId).single();
    expect(dealRow?.status).toBe("active");
  });

  it("rejects closing a deal that's already won/lost, before any write is attempted", async () => {
    const client = await signIn("m5-2-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const firstClose = await closeDeal(client, session.actor, ids.dealAlreadyClosedId, {
      result: "win",
      reasonId: ids.winReasonId,
      reasonDetail: null,
      competitorName: null,
      finalValueMinor: null,
      currencyCode: null,
      actualCloseDate: "2027-02-01",
    });
    expect(firstClose).toEqual({ ok: true });

    const secondClose = await closeDeal(client, session.actor, ids.dealAlreadyClosedId, {
      result: "loss",
      reasonId: ids.lossReasonId,
      reasonDetail: "irrelevant",
      competitorName: null,
      finalValueMinor: null,
      currencyCode: null,
      actualCloseDate: "2027-02-02",
    });
    expect(secondClose).toEqual({ ok: false, code: "already_closed" });
  });

  it("rejects a reason whose type doesn't match the requested result", async () => {
    const client = await signIn("m5-2-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await closeDeal(client, session.actor, ids.dealReasonMismatchId, {
      result: "loss",
      reasonId: ids.winReasonId,
      reasonDetail: "detail",
      competitorName: null,
      finalValueMinor: null,
      currencyCode: null,
      actualCloseDate: "2027-02-01",
    });

    expect(result).toEqual({ ok: false, code: "reason_type_mismatch" });
  });

  it("rejects a loss with no reason detail", async () => {
    const client = await signIn("m5-2-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await closeDeal(client, session.actor, ids.dealMissingDetailId, {
      result: "loss",
      reasonId: ids.lossReasonId,
      reasonDetail: "   ",
      competitorName: null,
      finalValueMinor: null,
      currencyCode: null,
      actualCloseDate: "2027-02-01",
    });

    expect(result).toEqual({ ok: false, code: "loss_requires_detail" });
  });

  it("rejects a competitor-required loss reason with no competitor name", async () => {
    const client = await signIn("m5-2-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await closeDeal(client, session.actor, ids.dealMissingCompetitorId, {
      result: "loss",
      reasonId: ids.competitorReasonId,
      reasonDetail: "They went elsewhere",
      competitorName: "  ",
      finalValueMinor: null,
      currencyCode: null,
      actualCloseDate: "2027-02-01",
    });

    expect(result).toEqual({ ok: false, code: "competitor_name_required" });

    const { data: dealRow } = await service.from("deals").select("status").eq("id", ids.dealMissingCompetitorId).single();
    expect(dealRow?.status).toBe("active");
  });

  it("returns not_found for a deal that doesn't exist", async () => {
    const client = await signIn("m5-2-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await closeDeal(client, session.actor, "00000000-0000-0000-0000-000000000000", {
      result: "win",
      reasonId: ids.winReasonId,
      reasonDetail: null,
      competitorName: null,
      finalValueMinor: null,
      currencyCode: null,
      actualCloseDate: "2027-02-01",
    });

    expect(result).toEqual({ ok: false, code: "not_found" });
  });
});
