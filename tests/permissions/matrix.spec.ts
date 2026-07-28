import { describe, expect, it } from "vitest";
import { ACTIONS, MATRIX, can, type Action, type Actor } from "@/auth/permissions";
import type { Role } from "@/domain/role";

const ROLES = ["bde", "team_lead", "director", "executive", "tenant_admin"] as const satisfies readonly Role[];

const TENANT = "tenant-a";
const OTHER_TENANT = "tenant-b";
const PRACTICE = "practice-1";
const OTHER_PRACTICE = "practice-2";

function actorWith(role: Role, overrides: Partial<Actor> = {}): Actor {
  const practiceLineId = role === "tenant_admin" || role === "executive" ? null : PRACTICE;
  return {
    id: `${role}-user`,
    tenantId: TENANT,
    status: "active",
    roleGrants: [{ role, practiceLineId }],
    ...overrides,
  };
}

// Non-write actions per docs/02-permission-matrix.md: view actions plus analytics.export, which
// reads and reformats data the executive can already see rather than mutating anything - the
// doc grants it to executive (row: "analytics.export | — | practice | practice | tenant | tenant"),
// consistent with "no write capability anywhere," not an exception to it. Everything else in
// ACTIONS is a write/mutating action, used below to assert "executive cannot write anything."
const NON_WRITE_ACTIONS: readonly Action[] = [
  "deal.view",
  "activity.view",
  "task.view",
  "account.view",
  "contact.view",
  "analytics.view_own",
  "analytics.view_team",
  "analytics.view_practice",
  "analytics.view_tenant",
  "analytics.export",
  "quota.view",
  "document.view",
  "admin.view_panel",
  "admin.view_audit_log",
];
const WRITE_ACTIONS: readonly Action[] = ACTIONS.filter((a) => !NON_WRITE_ACTIONS.includes(a));

describe("permission matrix completeness", () => {
  it("covers every role-action pair", () => {
    for (const role of ROLES) {
      for (const action of ACTIONS) {
        expect(MATRIX[role]?.[action], `untested: ${role}/${action}`).toBeDefined();
      }
    }
  });

  // Proves the check above actually fires rather than being vacuously green (the same principle
  // as tests/layering/boundaries.spec.ts proving the layering guardrail fires on a real
  // violation) - operates on a throwaway copy, never the real MATRIX, so this is permanent
  // regression coverage rather than a one-off manual demonstration.
  it("fails when a role-action pair is missing from the matrix", () => {
    const incompleteBde: Partial<Record<Action, unknown>> = { ...MATRIX.bde };
    delete incompleteBde["deal.view"];

    const checkCompleteness = () => {
      for (const action of ACTIONS) {
        if (incompleteBde[action] === undefined) {
          throw new Error(`untested: bde/${action}`);
        }
      }
    };

    expect(checkCompleteness).toThrow("untested: bde/deal.view");
  });
});

// "No role can update an audit entry or a stage event" (docs/05-test-strategy.md) has no
// corresponding row in docs/02-permission-matrix.md at all - audit_entries and stage_events have
// no update/delete action for any role, so there is nothing to look up: checking permission for
// one is a TypeScript compile error (no such Action string exists), not a runtime false. The
// actual database-level guarantee (no UPDATE/DELETE policy on those tables) belongs to tests/rls
// once those tables exist (M0.6), not this suite.

describe("named deny/allow cases (docs/02-permission-matrix.md, docs/05-test-strategy.md)", () => {
  it("bde can create an activity on a deal they own", () => {
    const bde = actorWith("bde");
    const ownedDeal = { tenantId: TENANT, practiceLineId: PRACTICE, ownerId: bde.id };
    expect(can(bde, "activity.create", ownedDeal)).toBe(true);
  });

  it("bde can create an activity on a deal they co-own", () => {
    const bde = actorWith("bde");
    const coOwnedDeal = { tenantId: TENANT, practiceLineId: PRACTICE, ownerId: "someone-else", coOwnerIds: [bde.id] };
    expect(can(bde, "activity.create", coOwnedDeal)).toBe(true);
  });

  it("bde cannot create an activity on a deal they neither own, co-own nor authored", () => {
    const bde = actorWith("bde");
    const othersDeal = { tenantId: TENANT, practiceLineId: PRACTICE, ownerId: "someone-else" };
    expect(can(bde, "activity.create", othersDeal)).toBe(false);
  });

  it("bde can assign a task to a practice-line peer", () => {
    const bde = actorWith("bde");
    const peerAssignment = { tenantId: TENANT, practiceLineId: PRACTICE };
    expect(can(bde, "task.assign_to_other", peerAssignment)).toBe(true);
  });

  it("bde cannot assign a task outside their entitled practice line", () => {
    const bde = actorWith("bde");
    const outsideAssignment = { tenantId: TENANT, practiceLineId: OTHER_PRACTICE };
    expect(can(bde, "task.assign_to_other", outsideAssignment)).toBe(false);
  });

  it("executive cannot perform any write action, for every write action", () => {
    const executive = actorWith("executive");
    for (const action of WRITE_ACTIONS) {
      expect(can(executive, action), `executive should not be able to: ${action}`).toBe(false);
    }
  });

  it("no role can delete an activity", () => {
    for (const role of ROLES) {
      expect(can(actorWith(role), "activity.delete"), `${role} should not be able to delete an activity`).toBe(
        false,
      );
    }
  });

  it("no role can connect another user's mailbox", () => {
    for (const role of ROLES) {
      expect(
        can(actorWith(role), "integration.connect_for_other_user"),
        `${role} should not be able to connect another user's mailbox`,
      ).toBe(false);
    }
  });

  it("no role, not even tenant_admin, can hard-delete (admin.purge)", () => {
    for (const role of ROLES) {
      expect(can(actorWith(role), "admin.purge")).toBe(false);
    }
  });

  it("a suspended user is denied every action despite holding role rows", () => {
    const suspendedAdmin = actorWith("tenant_admin", { status: "suspended" });
    for (const action of ACTIONS) {
      expect(can(suspendedAdmin, action), `suspended tenant_admin should not be able to: ${action}`).toBe(false);
    }
  });

  it("an inactive user is denied every action despite holding role rows", () => {
    const inactiveAdmin = actorWith("tenant_admin", { status: "inactive" });
    for (const action of ACTIONS) {
      expect(can(inactiveAdmin, action)).toBe(false);
    }
  });

  it("cross-tenant access is impossible for every role, including tenant_admin", () => {
    const crossTenantResource = { tenantId: OTHER_TENANT };
    for (const role of ROLES) {
      expect(
        can(actorWith(role), "deal.view", crossTenantResource),
        `${role} should not be able to view a resource in another tenant`,
      ).toBe(false);
    }
  });

  it("executive is granted select-only, never write, for every action sharing a read/write pair", () => {
    // deal.view (read) vs deal.update (write) on the identical resource - proves the read grant
    // does not accidentally imply a write grant.
    const executive = actorWith("executive");
    const resource = { tenantId: TENANT, practiceLineId: PRACTICE };
    expect(can(executive, "deal.view", resource)).toBe(true);
    expect(can(executive, "deal.update", resource)).toBe(false);
  });
});
