import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSessionActor } from "@/services/actor";
import { countActiveDealsWithoutNextAction, listPipelineDeals } from "@/services/deals";
import { createTask } from "@/services/tasks";
import { findOrCreateByUniqueMatch, findOrCreateTenant, findOrCreateUser, signIn as signInAs } from "./support/permanentFixture";

// M4.7 exit criteria (docs/07-build-backlog.md): "'No next step' filter and dashboard tile listing
// active deals lacking an open task." Proves src/data/deals.ts's noNextStep filter (via
// listPipelineDeals) and countDealsWithoutNextAction (via countActiveDealsWithoutNextAction)
// against the real hosted project, including the documented complement-of-"Next-action-coverage"
// behaviour: a won deal with no task is correctly EXCLUDED (it isn't active), only an active deal
// with no open task counts.
//
// A dedicated, isolated tenant (rather than extending pipeline-list.spec.ts's own large shared
// fixture) so countActiveDealsWithoutNextAction's tenant-wide count is exact and unambiguous - one
// qualifying deal, full stop, not "however many pipeline-list.spec.ts's fixture happens to leave
// lying around."

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M4-7-Integration-Test-Pw1!";

let service: SupabaseClient;

const ids = {
  tenantId: "",
  practiceLineId: "",
  discoveryStageId: "",
  wonStageId: "",
  accountId: "",
  bdeAuthId: "",
  dealWithTaskId: "",
  dealWithoutTaskId: "",
  wonDealId: "",
};

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

beforeAll(async () => {
  service = createServiceClient();

  ids.tenantId = await findOrCreateTenant(service, "m4-7-integration-test", "M4.7 Integration Test Tenant");

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
    { tenant_id: ids.tenantId, name: "Discovery", code: "DISCOVERY", sort_order: 1, probability_threshold: 20, stage_type: "open" },
  );
  ids.wonStageId = await findOrCreateByUniqueMatch(
    service,
    "pipeline_stages",
    { tenant_id: ids.tenantId, code: "WON" },
    { tenant_id: ids.tenantId, name: "Closed Won", code: "WON", sort_order: 2, probability_threshold: 100, stage_type: "won" },
  );

  ids.accountId = await findOrCreateByUniqueMatch(
    service,
    "accounts",
    { tenant_id: ids.tenantId, name: "M4.7 Test Client" },
    { tenant_id: ids.tenantId, name: "M4.7 Test Client" },
  );

  ids.bdeAuthId = await findOrCreateUser(service, ids.tenantId, "m4-7-bde@example.com", "M4.7 Bde", PASSWORD);

  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  await service.from("user_roles").insert({ tenant_id: ids.tenantId, user_id: ids.bdeAuthId, role: "bde", practice_line_id: ids.practiceLineId });

  await service.from("account_practice_owners").delete().eq("account_id", ids.accountId);
  await service.from("account_practice_owners").insert({ account_id: ids.accountId, practice_line_id: ids.practiceLineId, owner_id: ids.bdeAuthId });

  ids.dealWithTaskId = await findOrCreateByUniqueMatch(
    service,
    "deals",
    { tenant_id: ids.tenantId, reference: "D-NNS-1" },
    {
      tenant_id: ids.tenantId,
      reference: "D-NNS-1",
      name: "Deal With An Open Task",
      account_id: ids.accountId,
      practice_line_id: ids.practiceLineId,
      stage_id: ids.discoveryStageId,
      client_type: "new",
      owner_id: ids.bdeAuthId,
      author_id: ids.bdeAuthId,
      status: "active",
      expected_close_date: "2027-06-01",
    },
  );
  ids.dealWithoutTaskId = await findOrCreateByUniqueMatch(
    service,
    "deals",
    { tenant_id: ids.tenantId, reference: "D-NNS-2" },
    {
      tenant_id: ids.tenantId,
      reference: "D-NNS-2",
      name: "Deal Without Any Task",
      account_id: ids.accountId,
      practice_line_id: ids.practiceLineId,
      stage_id: ids.discoveryStageId,
      client_type: "new",
      owner_id: ids.bdeAuthId,
      author_id: ids.bdeAuthId,
      status: "active",
      expected_close_date: "2027-06-01",
    },
  );
  ids.wonDealId = await findOrCreateByUniqueMatch(
    service,
    "deals",
    { tenant_id: ids.tenantId, reference: "D-NNS-3" },
    {
      tenant_id: ids.tenantId,
      reference: "D-NNS-3",
      name: "Won Deal Without Any Task",
      account_id: ids.accountId,
      practice_line_id: ids.practiceLineId,
      stage_id: ids.wonStageId,
      client_type: "new",
      owner_id: ids.bdeAuthId,
      author_id: ids.bdeAuthId,
      status: "won",
      forecast_category: "closed",
      expected_close_date: "2026-01-01",
      negotiated_value_minor: "10000000",
      currency_code: "NGN",
    },
  );

  // Fresh, deterministic task state per run - soft-delete every prior task on dealWithTaskId (tasks
  // are permanently un-deletable once referenced, so "start clean" here means "start invisible").
  await service.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("deal_id", ids.dealWithTaskId).is("deleted_at", null);

  const bdeClient = await signIn("m4-7-bde@example.com");
  const bdeSession = await getSessionActor(bdeClient);
  if (bdeSession.status !== "active") throw new Error("expected an active session");
  const result = await createTask(bdeClient, bdeSession.actor, {
    dealId: ids.dealWithTaskId,
    originActivityId: null,
    title: "Follow up",
    description: null,
    assigneeId: ids.bdeAuthId,
    dueDate: "2027-06-15",
    priority: "normal",
  });
  if (!result.ok) throw new Error(`fixture createTask failed: ${result.code}`);
});

afterAll(async () => {
  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
});

describe("noNextStep filter and countActiveDealsWithoutNextAction, end to end against a real signed-in session", () => {
  it("listPipelineDeals with noNextStep returns only the active deal with no open task", async () => {
    const client = await signIn("m4-7-bde@example.com");
    const deals = await listPipelineDeals(client, { noNextStep: true }, "Africa/Lagos");

    expect(deals.map((d) => d.id)).toEqual([ids.dealWithoutTaskId]);
  });

  it("excludes a deal that has an open task", async () => {
    const client = await signIn("m4-7-bde@example.com");
    const deals = await listPipelineDeals(client, { noNextStep: true }, "Africa/Lagos");

    expect(deals.map((d) => d.id)).not.toContain(ids.dealWithTaskId);
  });

  it("excludes a won deal with no task - the filter means active AND no next step, not merely no next step", async () => {
    const client = await signIn("m4-7-bde@example.com");
    const deals = await listPipelineDeals(client, { noNextStep: true }, "Africa/Lagos");

    expect(deals.map((d) => d.id)).not.toContain(ids.wonDealId);
  });

  it("combining noNextStep with an explicit conflicting status filter yields zero rows, not a silent pick", async () => {
    const client = await signIn("m4-7-bde@example.com");
    const deals = await listPipelineDeals(client, { noNextStep: true, status: "won" }, "Africa/Lagos");

    expect(deals).toHaveLength(0);
  });

  it("countActiveDealsWithoutNextAction counts exactly the one qualifying deal, scoped to the caller's own session", async () => {
    const client = await signIn("m4-7-bde@example.com");
    const count = await countActiveDealsWithoutNextAction(client);

    expect(count).toBe(1);
  });
});
