import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSessionActor } from "@/services/actor";
import { createOutcomeReason, getOutcomeReasons, setOutcomeReasonActiveStatus } from "@/services/outcomeReasons";
import { findOrCreateByUniqueMatch, findOrCreateTenant, findOrCreateUser, signIn as signInAs } from "./support/permanentFixture";

// M5.1 exit criteria (docs/07-build-backlog.md): "`outcome_reasons` admin configuration." Proves,
// against the real hosted project, through real signed-in sessions: a tenant_admin can list,
// create and (de)activate outcome reasons; a bde is denied at the can() level for every one of
// those actions, even though migration 0016's own outcome_reasons_select RLS policy would let them
// READ the table directly - the admin SCREEN's own narrower scope is enforced by
// src/services/outcomeReasons.ts's explicit can() check, not by RLS alone.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M5-1-Integration-Test-Pw1!";

let service: SupabaseClient;

const ids = {
  tenantId: "",
  practiceLineId: "",
  adminAuthId: "",
  bdeAuthId: "",
};

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

beforeAll(async () => {
  service = createServiceClient();

  ids.tenantId = await findOrCreateTenant(service, "m5-1-integration-test", "M5.1 Integration Test Tenant");
  ids.practiceLineId = await findOrCreateByUniqueMatch(
    service,
    "practice_lines",
    { tenant_id: ids.tenantId, code: "ADV" },
    { tenant_id: ids.tenantId, name: "Advisory", code: "ADV" },
  );
  ids.adminAuthId = await findOrCreateUser(service, ids.tenantId, "m5-1-admin@example.com", "M5.1 Admin", PASSWORD);
  ids.bdeAuthId = await findOrCreateUser(service, ids.tenantId, "m5-1-bde@example.com", "M5.1 Bde", PASSWORD);

  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  const { error: roleError } = await service.from("user_roles").insert([
    { tenant_id: ids.tenantId, user_id: ids.adminAuthId, role: "tenant_admin", practice_line_id: null },
    { tenant_id: ids.tenantId, user_id: ids.bdeAuthId, role: "bde", practice_line_id: ids.practiceLineId },
  ]);
  if (roleError) throw new Error(`fixture role grant failed: ${roleError.message}`);

  await service.from("outcome_reasons").delete().eq("tenant_id", ids.tenantId);
});

afterAll(async () => {
  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
});

describe("outcome reasons admin service, end to end against a real signed-in session", () => {
  it("a tenant_admin can create a win reason and a loss reason", async () => {
    const client = await signIn("m5-1-admin@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const winResult = await createOutcomeReason(client, session.actor, { type: "win", label: "Best fit", sortOrder: 0 });
    expect(winResult.ok).toBe(true);

    const lossResult = await createOutcomeReason(client, session.actor, { type: "loss", label: "Lost to competitor", sortOrder: 0 });
    expect(lossResult.ok).toBe(true);

    const listed = await getOutcomeReasons(client, session.actor);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.reasons.map((r) => r.label)).toEqual(expect.arrayContaining(["Best fit", "Lost to competitor"]));
  });

  it("a bde cannot list, create, or (de)activate outcome reasons - denied at the can() level", async () => {
    const client = await signIn("m5-1-bde@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const listed = await getOutcomeReasons(client, session.actor);
    expect(listed).toEqual({ ok: false, code: "denied" });

    const created = await createOutcomeReason(client, session.actor, { type: "win", label: "Bde-invented reason", sortOrder: 0 });
    expect(created).toEqual({ ok: false, code: "denied" });

    const { data: existing } = await service.from("outcome_reasons").select("id").eq("tenant_id", ids.tenantId).limit(1).single();
    const toggled = await setOutcomeReasonActiveStatus(client, session.actor, existing!.id, false);
    expect(toggled).toEqual({ ok: false, code: "denied" });
  });

  it("a tenant_admin can deactivate and reactivate a reason", async () => {
    const client = await signIn("m5-1-admin@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const created = await createOutcomeReason(client, session.actor, { type: "win", label: "Round-trip reason", sortOrder: 1 });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const deactivated = await setOutcomeReasonActiveStatus(client, session.actor, created.reason.id, false);
    expect(deactivated.ok).toBe(true);

    const afterDeactivate = await getOutcomeReasons(client, session.actor);
    expect(afterDeactivate.ok).toBe(true);
    if (!afterDeactivate.ok) return;
    expect(afterDeactivate.reasons.find((r) => r.id === created.reason.id)?.isActive).toBe(false);

    const reactivated = await setOutcomeReasonActiveStatus(client, session.actor, created.reason.id, true);
    expect(reactivated.ok).toBe(true);

    const afterReactivate = await getOutcomeReasons(client, session.actor);
    expect(afterReactivate.ok).toBe(true);
    if (!afterReactivate.ok) return;
    expect(afterReactivate.reasons.find((r) => r.id === created.reason.id)?.isActive).toBe(true);
  });

  it("rejects creating a duplicate (type, label) pair", async () => {
    const client = await signIn("m5-1-admin@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    await createOutcomeReason(client, session.actor, { type: "win", label: "Duplicate test", sortOrder: 2 });
    await expect(createOutcomeReason(client, session.actor, { type: "win", label: "Duplicate test", sortOrder: 3 })).rejects.toThrow(
      /duplicate key value violates unique constraint/,
    );
  });
});
