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
  it("matches docs/06-ui-spec.md exactly for every role", () => {
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
    expect(NAV_BY_ROLE.director.map((i) => i.label)).toEqual([
      "Dashboard",
      "Pipeline Deals",
      "Accounts",
      "Reviews",
      "Analytics",
      "Files",
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

  it("/team is team_lead only", () => {
    expect(rolesAllowedForHref("/team")).toEqual(["team_lead"]);
  });

  it("/deals is reachable by every role (shared Pipeline/All Deals destination)", () => {
    expect(rolesAllowedForHref("/deals").sort()).toEqual([...ALL_ROLES].sort());
  });

  it("an unknown href is allowed for no role", () => {
    expect(rolesAllowedForHref("/nonexistent")).toEqual([]);
  });
});
