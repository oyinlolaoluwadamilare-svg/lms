import { describe, expect, it } from "vitest";
import { MATRIX, can, type Action, type Actor, type PermissionEntry, type ScopeToken } from "@/auth/permissions";
import type { Role } from "@/domain/role";

// M1.8 exit criteria (docs/07-build-backlog.md): "⚑ Permission and RLS tests for every deal
// action, allow and deny, per role." tests/permissions/matrix.spec.ts already proves every
// role-action pair is *defined* (completeness) and a handful of named deal cases; this file proves
// every deal.* action's scope token is *correct* against real resource shapes, for every role - the
// distinction that matters (docs/02-permission-matrix.md's own scope column) between "own" (bde:
// only a deal they own/co-own/author), "practice" (team_lead/director: any deal in an entitled
// practice, not just their own) and "tenant" (executive read-only view; tenant_admin everything).
//
// tests/rls/deals_permission_matrix.spec.ts (M1.8's other half) proves the same role/action
// boundary at the database level, and - the important finding that file documents - that RLS's
// deals_update policy cannot distinguish deal.update from deal.change_owner or any other specific
// write action a bde might attempt on their own row; only this can() matrix does.

const ROLES = ["bde", "team_lead", "director", "executive", "tenant_admin"] as const satisfies readonly Role[];
const DEAL_ACTIONS = [
  "deal.view",
  "deal.create",
  "deal.update",
  "deal.change_stage",
  "deal.change_owner",
  "deal.add_co_owner",
  "deal.mark_won",
  "deal.mark_lost",
  "deal.escalate",
  "deal.override_forecast_category",
  "deal.override_stage_gate",
  "deal.soft_delete",
  "deal.restore",
] as const satisfies readonly Action[];

const TENANT = "tenant-a";
const OTHER_TENANT = "tenant-b";
const PRACTICE = "practice-1";
const OTHER_PRACTICE = "practice-2";
const ACTOR_ID = "actor-under-test";

function actorWith(role: Role): Actor {
  const practiceLineId = role === "tenant_admin" || role === "executive" ? null : PRACTICE;
  return { id: ACTOR_ID, tenantId: TENANT, status: "active", roleGrants: [{ role, practiceLineId }] };
}

// Four resource shapes covering every scope boundary docs/02-permission-matrix.md's tokens name:
// - own: the actor is the deal's owner, in their own practice/tenant.
// - colleague: a practice-mate's deal - same practice/tenant, but NOT owned/co-owned/authored by
//   the actor. Distinguishes "own" (bde: denied) from "practice" (team_lead/director: allowed).
// - otherPractice: same tenant, a DIFFERENT practice the actor holds no grant in. Distinguishes
//   "practice" (denied) from "tenant" (executive/tenant_admin: allowed).
// - otherTenant: a different tenant entirely. Always denied, for every role, including tenant_admin
//   (CLAUDE.md's hard rule 6, already covered generically in tests/permissions/matrix.spec.ts -
//   included again here per-action for this suite's own completeness, not redundant with that one).
const RESOURCES = {
  own: { tenantId: TENANT, practiceLineId: PRACTICE, ownerId: ACTOR_ID },
  colleague: { tenantId: TENANT, practiceLineId: PRACTICE, ownerId: "someone-else" },
  otherPractice: { tenantId: TENANT, practiceLineId: OTHER_PRACTICE, ownerId: "someone-else" },
  otherTenant: { tenantId: OTHER_TENANT, practiceLineId: PRACTICE, ownerId: "someone-else" },
} as const;

type ResourceShape = keyof typeof RESOURCES;

// Derives the expected allow/deny for each resource shape purely from the scope token(s) a
// role-action pair grants - the same tokenMatches semantics src/auth/permissions.ts implements,
// re-derived independently here so this test can't just be asserting whatever can() already
// happens to return (that would make it circular and worthless as regression coverage).
function expectedFor(entry: PermissionEntry): Record<ResourceShape, boolean> {
  const tokens = new Set<ScopeToken>(entry ?? []);
  const hasOwn = tokens.has("own");
  const hasPractice = tokens.has("practice");
  const hasTenant = tokens.has("tenant");
  return {
    // Broader scopes imply the narrower ones - practice-wide access naturally covers your own
    // deal within that practice, and tenant-wide covers both.
    own: hasOwn || hasPractice || hasTenant,
    colleague: hasPractice || hasTenant,
    otherPractice: hasTenant,
    otherTenant: false,
  };
}

describe("deal permission matrix, exhaustive per role and action", () => {
  for (const action of DEAL_ACTIONS) {
    describe(action, () => {
      for (const role of ROLES) {
        const entry = MATRIX[role][action];
        const expected = expectedFor(entry);

        it(`${role}: own=${expected.own} colleague=${expected.colleague} otherPractice=${expected.otherPractice} otherTenant=false`, () => {
          const actor = actorWith(role);
          for (const shape of Object.keys(RESOURCES) as ResourceShape[]) {
            expect(can(actor, action, RESOURCES[shape]), `${role}/${action} on a "${shape}" deal`).toBe(expected[shape]);
          }
        });
      }
    });
  }

  // Proves the table above isn't vacuously checking itself against nothing: bde's real
  // deal.change_owner entry is null (denied for every shape including "own") - the one action in
  // this whole matrix where "own" doesn't imply access, unlike every other bde-grantable deal
  // action. If this entry were ever accidentally changed to ["own"], this specific assertion (not
  // just the generic table above) would catch it.
  it("bde can never change a deal's owner, not even their own - the one deal action where owning it isn't enough", () => {
    const bde = actorWith("bde");
    expect(can(bde, "deal.change_owner", RESOURCES.own)).toBe(false);
  });

  // The reverse named case: team_lead/director genuinely gain practice-wide reach that bde never
  // has for the same action - a colleague's deal, not their own.
  it("team_lead and director can change a colleague's deal's owner within their own practice; bde cannot", () => {
    expect(can(actorWith("team_lead"), "deal.change_owner", RESOURCES.colleague)).toBe(true);
    expect(can(actorWith("director"), "deal.change_owner", RESOURCES.colleague)).toBe(true);
    expect(can(actorWith("bde"), "deal.change_owner", RESOURCES.colleague)).toBe(false);
  });

  it("only director and tenant_admin can override a stage gate - team_lead and bde cannot, on any deal", () => {
    for (const shape of Object.keys(RESOURCES) as ResourceShape[]) {
      if (shape === "otherTenant") continue;
      expect(can(actorWith("bde"), "deal.override_stage_gate", RESOURCES[shape])).toBe(false);
      expect(can(actorWith("team_lead"), "deal.override_stage_gate", RESOURCES[shape])).toBe(false);
    }
    expect(can(actorWith("director"), "deal.override_stage_gate", RESOURCES.own)).toBe(true);
    expect(can(actorWith("tenant_admin"), "deal.override_stage_gate", RESOURCES.otherPractice)).toBe(true);
  });

  it("only tenant_admin can restore a soft-deleted deal - every other role is denied, even director", () => {
    for (const role of ROLES) {
      if (role === "tenant_admin") continue;
      expect(can(actorWith(role), "deal.restore", RESOURCES.own), `${role} should not be able to restore a deal`).toBe(false);
    }
    expect(can(actorWith("tenant_admin"), "deal.restore", RESOURCES.otherPractice)).toBe(true);
  });

  it("executive can view tenant-wide but is denied every deal write action, on every resource shape", () => {
    const executive = actorWith("executive");
    const writeActions = DEAL_ACTIONS.filter((a) => a !== "deal.view");
    for (const action of writeActions) {
      for (const shape of Object.keys(RESOURCES) as ResourceShape[]) {
        expect(can(executive, action, RESOURCES[shape]), `executive/${action} on a "${shape}" deal`).toBe(false);
      }
    }
    expect(can(executive, "deal.view", RESOURCES.otherPractice)).toBe(true);
  });
});
