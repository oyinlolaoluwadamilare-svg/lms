import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSessionActor } from "@/services/actor";
import { getStagesForAdmin, setStageBottleneckThreshold } from "@/services/pipelineStages";
import { findOrCreateByUniqueMatch, findOrCreateTenant, findOrCreateUser, signIn as signInAs } from "./support/permanentFixture";

// M6.3 exit criteria (docs/07-build-backlog.md): "Time in stage... bottleneck highlighting." Proves
// the new /admin/pipeline-stages screen's own service layer end to end, against the real hosted
// project through real signed-in sessions: a tenant_admin can read and set a stage's bottleneck
// threshold (including clearing it back to null); a bde is denied at the can() level for both -
// migration 0005's own pipeline_stages_update RLS policy would also block a bde's raw update
// (proven separately in tests/rls/deals_foundation.spec.ts), but this proves the SERVICE's own
// explicit gate, the same "narrower than what RLS alone would allow" shape
// tests/integration/outcome-reasons.spec.ts already established for its own sibling admin screen.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M6-3-Integration-Test-Pw1!";

let service: SupabaseClient;

const ids = {
  tenantId: "",
  practiceLineId: "",
  stageId: "",
  adminAuthId: "",
  bdeAuthId: "",
};

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

beforeAll(async () => {
  service = createServiceClient();

  ids.tenantId = await findOrCreateTenant(service, "m6-3-admin-integration-test", "M6.3 Admin Integration Test Tenant");
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
  ids.adminAuthId = await findOrCreateUser(service, ids.tenantId, "m6-3-admin@example.com", "M6.3 Admin", PASSWORD);
  ids.bdeAuthId = await findOrCreateUser(service, ids.tenantId, "m6-3-bde@example.com", "M6.3 Bde", PASSWORD);

  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  const { error: roleError } = await service.from("user_roles").insert([
    { tenant_id: ids.tenantId, user_id: ids.adminAuthId, role: "tenant_admin", practice_line_id: null },
    { tenant_id: ids.tenantId, user_id: ids.bdeAuthId, role: "bde", practice_line_id: ids.practiceLineId },
  ]);
  if (roleError) throw new Error(`fixture role grant failed: ${roleError.message}`);

  await service.from("pipeline_stages").update({ bottleneck_threshold_days: null }).eq("id", ids.stageId);
});

afterAll(async () => {
  await service.from("pipeline_stages").update({ bottleneck_threshold_days: null }).eq("id", ids.stageId);
  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
});

describe("pipeline stages admin service, end to end against a real signed-in session", () => {
  it("a tenant_admin can set and then clear a stage's bottleneck threshold", async () => {
    const client = await signIn("m6-3-admin@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const setResult = await setStageBottleneckThreshold(client, session.actor, ids.stageId, 14);
    expect(setResult.ok).toBe(true);

    const afterSet = await getStagesForAdmin(client, session.actor);
    expect(afterSet.ok).toBe(true);
    if (!afterSet.ok) return;
    expect(afterSet.stages.find((s) => s.id === ids.stageId)?.bottleneckThresholdDays).toBe(14);

    const clearResult = await setStageBottleneckThreshold(client, session.actor, ids.stageId, null);
    expect(clearResult.ok).toBe(true);

    const afterClear = await getStagesForAdmin(client, session.actor);
    expect(afterClear.ok).toBe(true);
    if (!afterClear.ok) return;
    expect(afterClear.stages.find((s) => s.id === ids.stageId)?.bottleneckThresholdDays).toBeNull();
  });

  it("a bde is denied at the can() level for both reading and writing", async () => {
    const client = await signIn("m6-3-bde@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const listed = await getStagesForAdmin(client, session.actor);
    expect(listed).toEqual({ ok: false, code: "denied" });

    const written = await setStageBottleneckThreshold(client, session.actor, ids.stageId, 30);
    expect(written).toEqual({ ok: false, code: "denied" });

    const { data: stageRow } = await service.from("pipeline_stages").select("bottleneck_threshold_days").eq("id", ids.stageId).single();
    expect(stageRow?.bottleneck_threshold_days).toBeNull();
  });
});
