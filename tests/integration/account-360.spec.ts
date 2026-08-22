import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSessionActor } from "@/services/actor";
import { getAccount360 } from "@/services/accounts";
import { findOrCreateByUniqueMatch, findOrCreateTenant, findOrCreateUser, signIn as signInAs } from "./support/permanentFixture";

// M5.8 exit criteria (docs/07-build-backlog.md): "Account 360 screen, showing each practice-line
// relationship with its own owner (D-03)." Proves getAccount360 end to end against the real hosted
// project, through real signed-in sessions, for exactly the scenario D-03 and docs/01-domain-
// model.md's own account_practice_owners comment describe: "a client sold to by two practice lines
// has two rows, potentially two different owners." A bde entitled to only ONE of those two practice
// lines sees only that practice line's own owner row and only that practice line's own deal
// (RLS's own account_practice_owners_select/deals_select scoping - "respecting entitlement",
// docs/06-ui-spec.md's own words for the Deals tab, falls out of RLS alone, not extra service-layer
// filtering); an executive sees both. Also proves D-15's own "won revenue" formula (recorded close
// value, falling back to deal value) and a bde with no entitlement to the account at all getting a
// clean not_found (null).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M5-8-Integration-Test-Pw1!";
const TIMEZONE = "Africa/Lagos";

let service: SupabaseClient;

const ids = {
  tenantId: "",
  practiceAdvId: "",
  practiceEsId: "",
  stageId: "",
  winReasonId: "",
  accountId: "",
  otherAccountId: "",
  advBdeAuthId: "",
  esBdeAuthId: "",
  advBdeNotEntitledToOtherAccountAuthId: "",
  executiveAuthId: "",
  advDealId: "",
  esDealId: "",
};

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

beforeAll(async () => {
  service = createServiceClient();

  ids.tenantId = await findOrCreateTenant(service, "m5-8-integration-test", "M5.8 Integration Test Tenant");

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
  ids.stageId = await findOrCreateByUniqueMatch(
    service,
    "pipeline_stages",
    { tenant_id: ids.tenantId, code: "DISCOVERY" },
    { tenant_id: ids.tenantId, name: "Discovery", code: "DISCOVERY", sort_order: 1, probability_threshold: 20, stage_type: "open" },
  );
  ids.winReasonId = await findOrCreateByUniqueMatch(
    service,
    "outcome_reasons",
    { tenant_id: ids.tenantId, type: "win", label: "Best fit" },
    { tenant_id: ids.tenantId, type: "win", label: "Best fit" },
  );

  ids.advBdeAuthId = await findOrCreateUser(service, ids.tenantId, "m5-8-adv-bde@example.com", "M5.8 Adv Bde", PASSWORD);
  ids.esBdeAuthId = await findOrCreateUser(service, ids.tenantId, "m5-8-es-bde@example.com", "M5.8 Es Bde", PASSWORD);
  ids.advBdeNotEntitledToOtherAccountAuthId = await findOrCreateUser(service, ids.tenantId, "m5-8-adv-bde-no-access-to-other-account@example.com", "M5.8 Adv Bde No Access To Other Account", PASSWORD);
  ids.executiveAuthId = await findOrCreateUser(service, ids.tenantId, "m5-8-executive@example.com", "M5.8 Executive", PASSWORD);

  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  await service.from("user_roles").insert([
    { tenant_id: ids.tenantId, user_id: ids.advBdeAuthId, role: "bde", practice_line_id: ids.practiceAdvId },
    { tenant_id: ids.tenantId, user_id: ids.esBdeAuthId, role: "bde", practice_line_id: ids.practiceEsId },
    { tenant_id: ids.tenantId, user_id: ids.advBdeNotEntitledToOtherAccountAuthId, role: "bde", practice_line_id: ids.practiceAdvId },
    { tenant_id: ids.tenantId, user_id: ids.executiveAuthId, role: "executive", practice_line_id: null },
  ]);

  ids.accountId = await findOrCreateByUniqueMatch(
    service,
    "accounts",
    { tenant_id: ids.tenantId, name: "M5.8 Two-Practice Client" },
    { tenant_id: ids.tenantId, name: "M5.8 Two-Practice Client" },
  );
  // A second account entitled only to ES - the ADV-only bde below has no practice-line relationship
  // to it at all, proving getAccount360 returns null (not_found) rather than a partially-populated
  // result for an account this actor can't see any part of.
  ids.otherAccountId = await findOrCreateByUniqueMatch(
    service,
    "accounts",
    { tenant_id: ids.tenantId, name: "M5.8 Es-Only Client" },
    { tenant_id: ids.tenantId, name: "M5.8 Es-Only Client" },
  );

  // D-03's own scenario: one account, sold to by two practice lines, two different owners.
  await service.from("account_practice_owners").delete().in("account_id", [ids.accountId, ids.otherAccountId]);
  await service.from("account_practice_owners").insert([
    { account_id: ids.accountId, practice_line_id: ids.practiceAdvId, owner_id: ids.advBdeAuthId },
    { account_id: ids.accountId, practice_line_id: ids.practiceEsId, owner_id: ids.esBdeAuthId },
    { account_id: ids.otherAccountId, practice_line_id: ids.practiceEsId, owner_id: ids.esBdeAuthId },
  ]);

  ids.advDealId = await findOrCreateByUniqueMatch(
    service,
    "deals",
    { tenant_id: ids.tenantId, reference: "D-5-8-ADV" },
    {
      tenant_id: ids.tenantId,
      reference: "D-5-8-ADV",
      name: "M5.8 Advisory Deal",
      account_id: ids.accountId,
      practice_line_id: ids.practiceAdvId,
      stage_id: ids.stageId,
      client_type: "new",
      owner_id: ids.advBdeAuthId,
      author_id: ids.advBdeAuthId,
      status: "active",
      proposal_value_minor: 500_000_00,
      currency_code: "NGN",
      expected_close_date: "2027-06-01",
    },
  );

  // Seeded directly as already-won via the service client, the same "no stage_events row needed"
  // shortcut src/services/reports.ts's own M5.4 fixture already established for a seeded-lost deal -
  // this fixture only needs the WON status and a deal_outcomes row, not a real changeStage/closeDeal
  // history.
  const { data: existingEsDeal } = await service.from("deals").select("id").eq("tenant_id", ids.tenantId).eq("reference", "D-5-8-ES").maybeSingle();
  if (existingEsDeal) {
    ids.esDealId = existingEsDeal.id;
  } else {
    const { data: created, error } = await service
      .from("deals")
      .insert({
        tenant_id: ids.tenantId,
        reference: "D-5-8-ES",
        name: "M5.8 Executive Search Deal",
        account_id: ids.accountId,
        practice_line_id: ids.practiceEsId,
        stage_id: ids.stageId,
        client_type: "new",
        owner_id: ids.esBdeAuthId,
        author_id: ids.esBdeAuthId,
        status: "won",
        proposal_value_minor: 1_000_000_00,
        currency_code: "NGN",
        expected_close_date: "2027-01-01",
        actual_close_date: "2027-01-01",
      })
      .select("id")
      .single();
    if (error) throw new Error(`seed ES deal failed: ${error.message}`);
    ids.esDealId = created.id;
  }
  await service.from("deal_outcomes").delete().eq("deal_id", ids.esDealId);
  await service.from("deal_outcomes").insert({
    deal_id: ids.esDealId,
    result: "win",
    reason_id: ids.winReasonId,
    final_value_minor: 1_200_000_00,
    currency_code: "NGN",
    actual_close_date: "2027-01-01",
    closed_by: ids.esBdeAuthId,
  });
});

afterAll(async () => {
  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  // Deliberately not deleting deal_outcomes/deals/account_practice_owners/accounts/practice_lines/
  // users/tenant - deal_outcomes and deals are permanently un-deletable once seeded (the same
  // stage_events/audit_entries FK-pinning chain tests/integration/pipeline-list.spec.ts's own M2.1
  // fixture fix already documented). beforeAll is find-or-create for all of these.
});

describe("getAccount360, end to end against a real signed-in session", () => {
  it("a bde entitled to only the Advisory practice sees only that practice's own owner row and deal", async () => {
    const client = await signIn("m5-8-adv-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const account = await getAccount360(client, ids.accountId, TIMEZONE);
    expect(account).not.toBeNull();
    if (!account) return;

    expect(account.practiceLineOwners.map((po) => po.practiceLineId)).toEqual([ids.practiceAdvId]);
    expect(account.deals.map((d) => d.id)).toEqual([ids.advDealId]);
    expect(account.tiles.activeDealsCount).toBe(1);
    expect(account.tiles.openPipelineValue).toEqual([{ amountMinor: 50_000_000n, currency: "NGN" }]);
    // The ES deal (won, RLS-invisible to this bde) never contributes here.
    expect(account.tiles.wonRevenue).toEqual([]);
  });

  it("a bde entitled to only Executive Search sees only that practice's own owner row, deal and won revenue", async () => {
    const client = await signIn("m5-8-es-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const account = await getAccount360(client, ids.accountId, TIMEZONE);
    expect(account).not.toBeNull();
    if (!account) return;

    expect(account.practiceLineOwners.map((po) => po.practiceLineId)).toEqual([ids.practiceEsId]);
    expect(account.deals.map((d) => d.id)).toEqual([ids.esDealId]);
    expect(account.tiles.activeDealsCount).toBe(0);
    expect(account.tiles.openPipelineValue).toEqual([]);
    // D-15: prefers deal_outcomes.final_value_minor (120,000,000 kobo) over the deal's own proposal
    // value (100,000,000 kobo).
    expect(account.tiles.wonRevenue).toEqual([{ amountMinor: 120_000_000n, currency: "NGN" }]);
  });

  it("an executive sees both practice-line owner rows and both deals - tenant-wide", async () => {
    const client = await signIn("m5-8-executive@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const account = await getAccount360(client, ids.accountId, TIMEZONE);
    expect(account).not.toBeNull();
    if (!account) return;

    expect(new Set(account.practiceLineOwners.map((po) => po.practiceLineId))).toEqual(new Set([ids.practiceAdvId, ids.practiceEsId]));
    expect(new Set(account.deals.map((d) => d.id))).toEqual(new Set([ids.advDealId, ids.esDealId]));
    expect(account.tiles.openPipelineValue).toEqual([{ amountMinor: 50_000_000n, currency: "NGN" }]);
    expect(account.tiles.wonRevenue).toEqual([{ amountMinor: 120_000_000n, currency: "NGN" }]);
  });

  it("an ADV-entitled bde with no relationship to a different, ES-only account gets a clean not_found (null)", async () => {
    const client = await signIn("m5-8-adv-bde-no-access-to-other-account@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const account = await getAccount360(client, ids.otherAccountId, TIMEZONE);
    expect(account).toBeNull();
  });
});
