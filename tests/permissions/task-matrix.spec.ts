import { describe, expect, it } from "vitest";
import { MATRIX, can, type Action, type Actor, type PermissionEntry, type ScopeToken } from "@/auth/permissions";
import type { Role } from "@/domain/role";

// M4.10 exit criteria (docs/07-build-backlog.md): "⚑ Permission tests: a BDE can assign to a
// practice peer; an Executive cannot assign at all; reassignment history is never overwritten."
// Mirrors tests/permissions/deal-matrix.spec.ts's own exhaustive per-role/per-action style (that
// file's own header: "tests/permissions/matrix.spec.ts already proves every role-action pair is
// *defined*... this file proves every [domain].* action's scope token is *correct* against real
// resource shapes, for every role"). Tasks have two person-relations, not deals' one - assigneeId
// ("assigned") and assignedById ("assigned_by") are DISTINCT scope tokens that can appear
// independently, unlike deal.*'s single "own" token covering owner/co-owner/author together. That
// distinction is exactly what surfaces the real, easy-to-miss asymmetry this file's own named case
// calls out below: task.reassign grants ["assigned"] only, never ["assigned_by"] - the task's
// CURRENT assignee may hand it onward, but the person who originally assigned it (and is no longer
// holding it) cannot reclaim it themselves without practice-wide reach. assignTask's own comment in
// src/services/tasks.ts already documents this; this file is what actually pins it down as a
// regression-tested fact rather than an assertion living only in a comment.
//
// task_assignments' own immutability ("reassignment history is never overwritten",
// docs/01-domain-model.md's "the immutable reassignment ledger") is a database-level guarantee
// (forbid_mutation(), migration 0011), not a can()-expressible one - proven at
// tests/rls/tasks.spec.ts's own task_assignments describe block instead, extended by this
// milestone to prove it for an authenticated tenant_admin identity too (previously only the
// migrator/superuser identity was tested there), the same two-tier shape
// tests/rls/audit_log.spec.ts already established for the other immutable ledger table this
// codebase has.

const ROLES = ["bde", "team_lead", "director", "executive", "tenant_admin"] as const satisfies readonly Role[];
const TASK_ACTIONS = [
  "task.create",
  "task.view",
  "task.assign_to_other",
  "task.reassign",
  "task.update",
  "task.complete",
  "task.cancel",
  "task.comment",
  "task.mention_user",
  "task.watch",
  "task.add_watcher",
  "task.resolve_comment",
] as const satisfies readonly Action[];
// task.assign_to_self is deliberately excluded from the grid below and tested separately - unlike
// the twelve actions above, which all check an EXISTING task's assignee/assigned_by relationship,
// assign_to_self checks the task ABOUT TO BE CREATED, whose assigneeId is the actor themselves by
// construction (that is what "self" means) - there is no "assigned_by" dimension to vary yet, so it
// doesn't fit the same five-shape grid the others do.

const TENANT = "tenant-a";
const OTHER_TENANT = "tenant-b";
const PRACTICE = "practice-1";
const OTHER_PRACTICE = "practice-2";
const ACTOR_ID = "actor-under-test";

function actorWith(role: Role): Actor {
  const practiceLineId = role === "tenant_admin" || role === "executive" ? null : PRACTICE;
  return { id: ACTOR_ID, tenantId: TENANT, status: "active", roleGrants: [{ role, practiceLineId }] };
}

// Five resource shapes covering every scope boundary a task action's tokens can name:
// - assignee: the actor IS the task's current assignee, assigned by someone else.
// - assigner: the actor IS the task's assigned_by, assigned to someone else - the mirror image of
//   assignee, needed because "assigned" and "assigned_by" are independent tokens for tasks (unlike
//   deals' single "own").
// - practicePeer: same tenant/practice, but the actor is NEITHER the assignee NOR the assigner -
//   distinguishes "assigned"/"assigned_by" (bde: denied here) from "practice" (team_lead/director:
//   allowed).
// - otherPractice: same tenant, a different practice the actor holds no grant in - distinguishes
//   "practice" (denied) from "tenant" (executive view/tenant_admin: allowed).
// - otherTenant: a different tenant entirely - always denied, for every role, including tenant_admin
//   (CLAUDE.md's hard cross-tenant rule, generically covered in tests/permissions/matrix.spec.ts;
//   included again here per-action for this suite's own completeness, the same reasoning
//   deal-matrix.spec.ts's own header gives for repeating it).
const RESOURCES = {
  assignee: { tenantId: TENANT, practiceLineId: PRACTICE, assigneeId: ACTOR_ID, assignedById: "someone-else" },
  assigner: { tenantId: TENANT, practiceLineId: PRACTICE, assigneeId: "someone-else", assignedById: ACTOR_ID },
  practicePeer: { tenantId: TENANT, practiceLineId: PRACTICE, assigneeId: "someone-else", assignedById: "someone-else-too" },
  otherPractice: { tenantId: TENANT, practiceLineId: OTHER_PRACTICE, assigneeId: "someone-else", assignedById: "someone-else-too" },
  otherTenant: { tenantId: OTHER_TENANT, practiceLineId: PRACTICE, assigneeId: "someone-else", assignedById: "someone-else-too" },
} as const;

type ResourceShape = keyof typeof RESOURCES;

// Derives the expected allow/deny for each resource shape purely from the scope token(s) a
// role-action pair grants - re-derived independently of src/auth/permissions.ts's own tokenMatches
// so this test can't just be asserting whatever can() already happens to return.
function expectedFor(entry: PermissionEntry): Record<ResourceShape, boolean> {
  const tokens = new Set<ScopeToken>(entry ?? []);
  const hasAssigned = tokens.has("assigned");
  const hasAssignedBy = tokens.has("assigned_by");
  const hasPractice = tokens.has("practice");
  const hasTenant = tokens.has("tenant");
  return {
    // Broader scopes imply the narrower ones - practice-wide access naturally covers the actor's
    // own assignee/assigner relationship within that practice too.
    assignee: hasAssigned || hasPractice || hasTenant,
    assigner: hasAssignedBy || hasPractice || hasTenant,
    practicePeer: hasPractice || hasTenant,
    otherPractice: hasTenant,
    otherTenant: false,
  };
}

describe("task permission matrix, exhaustive per role and action", () => {
  for (const action of TASK_ACTIONS) {
    describe(action, () => {
      for (const role of ROLES) {
        const entry = MATRIX[role][action];
        const expected = expectedFor(entry);

        it(`${role}: assignee=${expected.assignee} assigner=${expected.assigner} practicePeer=${expected.practicePeer} otherPractice=${expected.otherPractice} otherTenant=false`, () => {
          const actor = actorWith(role);
          for (const shape of Object.keys(RESOURCES) as ResourceShape[]) {
            expect(can(actor, action, RESOURCES[shape]), `${role}/${action} on a "${shape}" task`).toBe(expected[shape]);
          }
        });
      }
    });
  }

  // The M4.10 backlog line's own first named case: "a BDE can assign to a practice peer" - for
  // BOTH the create-a-new-assignment action and the reassign-an-existing-task action, since they
  // are genuinely different actions with different (if overlapping) scopes.
  it("a bde can assign a NEW task to a practice-line peer (task.assign_to_other)", () => {
    const bde = actorWith("bde");
    expect(can(bde, "task.assign_to_other", RESOURCES.practicePeer)).toBe(true);
  });

  it("a bde cannot assign a new task to someone outside their entitled practice line", () => {
    const bde = actorWith("bde");
    expect(can(bde, "task.assign_to_other", RESOURCES.otherPractice)).toBe(false);
  });

  // The easy-to-miss asymmetry this file's own header comment explains: task.reassign is
  // ["assigned"] only for bde, never ["assigned_by"] - the CURRENT assignee may hand a task
  // onward, but the person who originally assigned it away is not automatically entitled to
  // reclaim it, unlike task.update/task.complete/task.resolve_comment, which grant both.
  it("a bde who is the task's CURRENT assignee can reassign it to a practice peer", () => {
    const bde = actorWith("bde");
    expect(can(bde, "task.reassign", RESOURCES.assignee)).toBe(true);
  });

  it("a bde who merely assigned the task away (assigned_by) cannot reassign it - only the current assignee can", () => {
    const bde = actorWith("bde");
    expect(can(bde, "task.reassign", RESOURCES.assigner)).toBe(false);
  });

  it("team_lead and director can reassign any task practice-wide, even one they are neither assigned to nor assigned by", () => {
    expect(can(actorWith("team_lead"), "task.reassign", RESOURCES.practicePeer)).toBe(true);
    expect(can(actorWith("director"), "task.reassign", RESOURCES.practicePeer)).toBe(true);
    expect(can(actorWith("bde"), "task.reassign", RESOURCES.practicePeer)).toBe(false);
  });

  // The M4.10 backlog line's own second named case: "an Executive cannot assign at all" - named
  // explicitly for every assignment-shaped action, not left to the generic write-action sweep in
  // tests/permissions/matrix.spec.ts alone.
  it("an executive cannot assign a task to themselves, to anyone else, or reassign an existing one - on any resource shape", () => {
    const executive = actorWith("executive");
    const assignmentActions = ["task.assign_to_self", "task.assign_to_other", "task.reassign"] as const satisfies readonly Action[];
    for (const action of assignmentActions) {
      for (const shape of Object.keys(RESOURCES) as ResourceShape[]) {
        expect(can(executive, action, RESOURCES[shape]), `executive/${action} on a "${shape}" task`).toBe(false);
      }
    }
  });

  it("executive can view tenant-wide but is denied every task write action, on every resource shape", () => {
    const executive = actorWith("executive");
    const writeActions = TASK_ACTIONS.filter((a) => a !== "task.view");
    for (const action of writeActions) {
      for (const shape of Object.keys(RESOURCES) as ResourceShape[]) {
        expect(can(executive, action, RESOURCES[shape]), `executive/${action} on a "${shape}" task`).toBe(false);
      }
    }
    expect(can(executive, "task.view", RESOURCES.otherPractice)).toBe(true);
  });

  // task.assign_to_self's own special shape (see this file's header comment): the resource always
  // carries assigneeId = the actor themselves, since that is what "self" means - every practice-
  // scoped role may claim a task for themselves; executive alone is denied.
  describe("task.assign_to_self", () => {
    const selfAssignResource = { tenantId: TENANT, practiceLineId: PRACTICE, assigneeId: ACTOR_ID };

    it("bde, team_lead, director and tenant_admin can all assign a task to themselves", () => {
      for (const role of ["bde", "team_lead", "director", "tenant_admin"] as const) {
        expect(can(actorWith(role), "task.assign_to_self", selfAssignResource), `${role} should be able to self-assign`).toBe(true);
      }
    });

    it("executive cannot assign a task to themselves either", () => {
      expect(can(actorWith("executive"), "task.assign_to_self", selfAssignResource)).toBe(false);
    });
  });
});
