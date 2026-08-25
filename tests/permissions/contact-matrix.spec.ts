import { describe, expect, it } from "vitest";
import { MATRIX, can, type Action, type Actor, type PermissionEntry, type ScopeToken } from "@/auth/permissions";
import type { Role } from "@/domain/role";

// M5.5 exit criteria (docs/07-build-backlog.md): "`contacts`, `deal_contacts` migrations;
// primary-contact invariant." contact.view/contact.create/contact.update/contact.link_to_deal were
// scaffolded into src/auth/permissions.ts from early on (tests/permissions/matrix.spec.ts's own
// completeness check already covered contact.view specifically) but never exercised by real code
// until this milestone - the same "scaffolded early, unused" situation M5.4 found for
// analytics.view_practice. This file is the dedicated per-action scope test
// tests/permissions/deal-matrix.spec.ts's own header comment names as the pattern for "every
// action's scope token is correct against real resource shapes, for every role," not merely that
// every role-action pair is *defined*.

const ROLES = ["bde", "team_lead", "director", "executive", "tenant_admin"] as const satisfies readonly Role[];

const TENANT = "tenant-a";
const OTHER_TENANT = "tenant-b";
const PRACTICE = "practice-1";
const OTHER_PRACTICE = "practice-2";
const ACTOR_ID = "actor-under-test";

function actorWith(role: Role): Actor {
  const practiceLineId = role === "tenant_admin" || role === "executive" ? null : PRACTICE;
  return { id: ACTOR_ID, tenantId: TENANT, status: "active", roleGrants: [{ role, practiceLineId }] };
}

// contact.view/create/update have no "own" token anywhere in docs/02-permission-matrix.md (unlike
// deal.update) - a contact belongs to an account, not to the acting user, so there is no
// "own" contact the way there's an "own" deal. Modelled with the same three practice/tenant-boundary
// shapes deal-matrix.spec.ts uses, minus the "own" one that doesn't apply here.
const ACCOUNT_SCOPED_RESOURCES = {
  practice: { tenantId: TENANT, practiceLineId: PRACTICE },
  otherPractice: { tenantId: TENANT, practiceLineId: OTHER_PRACTICE },
  otherTenant: { tenantId: OTHER_TENANT, practiceLineId: PRACTICE },
} as const;

// contact.link_to_deal shares deal.add_co_owner's exact own/practice/practice/-/tenant scope
// (docs/02-permission-matrix.md) - the same four deal-resource shapes deal-matrix.spec.ts already
// established, since linking a contact is authorised against the DEAL being linked to, not the
// contact or its account (src/services/contacts.ts's own linkContactToDeal builds exactly this
// Resource shape from the deal, never from the contact).
const DEAL_SCOPED_RESOURCES = {
  own: { tenantId: TENANT, practiceLineId: PRACTICE, ownerId: ACTOR_ID },
  colleague: { tenantId: TENANT, practiceLineId: PRACTICE, ownerId: "someone-else" },
  otherPractice: { tenantId: TENANT, practiceLineId: OTHER_PRACTICE, ownerId: "someone-else" },
  otherTenant: { tenantId: OTHER_TENANT, practiceLineId: PRACTICE, ownerId: "someone-else" },
} as const;

function expectedForAccountScoped(entry: PermissionEntry): Record<keyof typeof ACCOUNT_SCOPED_RESOURCES, boolean> {
  const tokens = new Set<ScopeToken>(entry ?? []);
  const hasPractice = tokens.has("practice");
  const hasTenant = tokens.has("tenant");
  return { practice: hasPractice || hasTenant, otherPractice: hasTenant, otherTenant: false };
}

function expectedForDealScoped(entry: PermissionEntry): Record<keyof typeof DEAL_SCOPED_RESOURCES, boolean> {
  const tokens = new Set<ScopeToken>(entry ?? []);
  const hasOwn = tokens.has("own");
  const hasPractice = tokens.has("practice");
  const hasTenant = tokens.has("tenant");
  return {
    own: hasOwn || hasPractice || hasTenant,
    colleague: hasPractice || hasTenant,
    otherPractice: hasTenant,
    otherTenant: false,
  };
}

describe("contact permission matrix, exhaustive per role and action", () => {
  // M5.9 (docs/07-build-backlog.md): "Handover panel... shown on owner change." account.
  // reassign_owner shares contact.view/create/update's exact account-scoped, no-"own"-token shape -
  // a bde cannot reassign who owns a practice-line relationship any more than they can merge an
  // account, the same "structurally cannot do this" reasoning deal.change_owner's own comment gives.
  describe("account.reassign_owner / contact.view / contact.create / contact.update - account-scoped, no 'own' token", () => {
    for (const action of [
      "account.reassign_owner",
      "contact.view",
      "contact.create",
      "contact.update",
    ] as const satisfies readonly Action[]) {
      describe(action, () => {
        for (const role of ROLES) {
          const entry = MATRIX[role][action];
          const expected = expectedForAccountScoped(entry);

          it(`${role}: practice=${expected.practice} otherPractice=${expected.otherPractice} otherTenant=false`, () => {
            const actor = actorWith(role);
            expect(can(actor, action, ACCOUNT_SCOPED_RESOURCES.practice)).toBe(expected.practice);
            expect(can(actor, action, ACCOUNT_SCOPED_RESOURCES.otherPractice)).toBe(expected.otherPractice);
            expect(can(actor, action, ACCOUNT_SCOPED_RESOURCES.otherTenant)).toBe(false);
          });
        }
      });
    }
  });

  describe("contact.link_to_deal - deal-scoped, mirrors deal.add_co_owner exactly", () => {
    for (const role of ROLES) {
      const entry = MATRIX[role]["contact.link_to_deal"];
      const expected = expectedForDealScoped(entry);

      it(`${role}: own=${expected.own} colleague=${expected.colleague} otherPractice=${expected.otherPractice} otherTenant=false`, () => {
        const actor = actorWith(role);
        expect(can(actor, "contact.link_to_deal", DEAL_SCOPED_RESOURCES.own)).toBe(expected.own);
        expect(can(actor, "contact.link_to_deal", DEAL_SCOPED_RESOURCES.colleague)).toBe(expected.colleague);
        expect(can(actor, "contact.link_to_deal", DEAL_SCOPED_RESOURCES.otherPractice)).toBe(expected.otherPractice);
        expect(can(actor, "contact.link_to_deal", DEAL_SCOPED_RESOURCES.otherTenant)).toBe(false);
      });
    }
  });

  it("mirrors docs/02-permission-matrix.md's contact.link_to_deal scope exactly: own/practice/practice/-/tenant", () => {
    expect(MATRIX.bde["contact.link_to_deal"]).toEqual(["own"]);
    expect(MATRIX.team_lead["contact.link_to_deal"]).toEqual(["practice"]);
    expect(MATRIX.director["contact.link_to_deal"]).toEqual(["practice"]);
    expect(MATRIX.executive["contact.link_to_deal"]).toBeNull();
    expect(MATRIX.tenant_admin["contact.link_to_deal"]).toEqual(["tenant"]);
  });

  it("mirrors docs/02-permission-matrix.md's account.reassign_owner scope exactly: -/practice/practice/-/tenant", () => {
    expect(MATRIX.bde["account.reassign_owner"]).toBeNull();
    expect(MATRIX.team_lead["account.reassign_owner"]).toEqual(["practice"]);
    expect(MATRIX.director["account.reassign_owner"]).toEqual(["practice"]);
    expect(MATRIX.executive["account.reassign_owner"]).toBeNull();
    expect(MATRIX.tenant_admin["account.reassign_owner"]).toEqual(["tenant"]);
  });
});
