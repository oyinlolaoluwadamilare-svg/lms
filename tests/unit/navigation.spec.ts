import { describe, expect, it } from "vitest";
import {
  NAV_BY_ROLE,
  defaultLandingHref,
  navItemsForRoles,
  rolesAllowedForHref,
} from "../../src/domain/navigation";
import type { Role } from "../../src/domain/role";

const ALL_ROLES: readonly Role[] = ["bde", "team_lead", "director", "executive", "tenant_admin"];

describe("NAV_BY_ROLE", () => {
  it("matches docs/06-ui-spec.md for bde, team_lead, executive and tenant_admin exactly", () => {
    expect(NAV_BY_ROLE.bde.map((i) => i.label)).toEqual([
      "My Work",
      "Business Lines",
      "Pipeline Deals",
      "Accounts",
      "Files",
      "Analytics",
    ]);
    expect(NAV_BY_ROLE.team_lead.map((i) => i.label)).toEqual([
      "My Work",
      "Team",
      "Pipeline Deals",
      "Accounts",
      "Files",
      "Analytics",
    ]);
    expect(NAV_BY_ROLE.executive.map((i) => i.label)).toEqual(["Dashboard", "Analytics", "Pipeline (read)"]);
    expect(NAV_BY_ROLE.tenant_admin.map((i) => i.label)).toEqual([
      "Dashboard",
      "All Deals",
      "Accounts",
      "Analytics",
      "Admin",
    ]);
  });

  // M4.6 (docs/07-build-backlog.md: "Team view for Team Lead and Director...") added "Team" to
  // Director's own nav - docs/06-ui-spec.md's own "Navigation, per role" table lists Director's nav
  // without it ("Dashboard · Pipeline Deals · Accounts · Reviews · Analytics · Files"), a genuine
  // inconsistency with that same backlog line explicitly naming Director. Asked via
  // AskUserQuestion, unanswered; the recommended default was taken (src/domain/navigation.ts's own
  // comment on the director array has the full reasoning) - this assertion documents the deviation
  // from the table's literal text rather than silently matching it.
  it("director's nav includes Team (M4.6), a deliberate addition beyond docs/06-ui-spec.md's own table", () => {
    expect(NAV_BY_ROLE.director.map((i) => i.label)).toEqual([
      "Dashboard",
      "Team",
      "Pipeline Deals",
      "Accounts",
      "Reviews",
      "Analytics",
      "Files",
    ]);
  });
});

describe("navItemsForRoles", () => {
  it("returns a single role's own nav items in order", () => {
    expect(navItemsForRoles(["director"])).toEqual(NAV_BY_ROLE.director);
  });

  it("merges nav items across multiple held roles, deduplicated by href", () => {
    const merged = navItemsForRoles(["bde", "team_lead"]);
    const hrefs = merged.map((i) => i.href);
    expect(hrefs).toEqual(["/my-work", "/business-lines", "/deals", "/accounts", "/files", "/analytics", "/team"]);
    expect(new Set(hrefs).size).toBe(hrefs.length); // no duplicate href even though both roles share several
  });

  it("returns an empty menu for no roles", () => {
    expect(navItemsForRoles([])).toEqual([]);
  });
});

describe("defaultLandingHref", () => {
  it("lands bde and team_lead on My Work", () => {
    expect(defaultLandingHref(["bde"])).toBe("/my-work");
    expect(defaultLandingHref(["team_lead"])).toBe("/my-work");
  });

  it("lands director, executive and tenant_admin on Dashboard", () => {
    expect(defaultLandingHref(["director"])).toBe("/dashboard");
    expect(defaultLandingHref(["executive"])).toBe("/dashboard");
    expect(defaultLandingHref(["tenant_admin"])).toBe("/dashboard");
  });

  it("prefers My Work when a user holds both a My-Work role and a Dashboard role", () => {
    expect(defaultLandingHref(["director", "bde"])).toBe("/my-work");
  });
});

describe("rolesAllowedForHref", () => {
  it("every role in the matrix can reach at least one route", () => {
    for (const role of ALL_ROLES) {
      const reachable = NAV_BY_ROLE[role].some((item) => rolesAllowedForHref(item.href).includes(role));
      expect(reachable, `${role} should be allowed on at least one of its own nav hrefs`).toBe(true);
    }
  });

  it("/admin is tenant_admin only", () => {
    expect(rolesAllowedForHref("/admin")).toEqual(["tenant_admin"]);
  });

  it("/team is team_lead and director (M4.6)", () => {
    expect(rolesAllowedForHref("/team").sort()).toEqual(["director", "team_lead"]);
  });

  it("/deals is reachable by every role (shared Pipeline/All Deals destination)", () => {
    expect(rolesAllowedForHref("/deals").sort()).toEqual([...ALL_ROLES].sort());
  });

  it("an unknown href is allowed for no role", () => {
    expect(rolesAllowedForHref("/nonexistent")).toEqual([]);
  });
});
