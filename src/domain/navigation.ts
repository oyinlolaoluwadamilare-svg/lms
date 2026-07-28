import type { Role } from "@/domain/role";

// docs/06-ui-spec.md "Navigation, per role" table, verbatim. Lives in domain (not ui) because both
// src/ui's Nav component (rendering) and route-level access gating (an auth-adjacent concern) need
// it, and domain is the one layer both are allowed to import (see eslint.config.mjs boundaries).
export interface NavItem {
  label: string;
  href: string;
}

export const NAV_BY_ROLE: Record<Role, readonly NavItem[]> = {
  bde: [
    { label: "My Work", href: "/my-work" },
    { label: "Business Lines", href: "/business-lines" },
    { label: "Pipeline Deals", href: "/deals" },
    { label: "Accounts", href: "/accounts" },
    { label: "Files", href: "/files" },
    { label: "Analytics", href: "/analytics" },
  ],
  team_lead: [
    { label: "My Work", href: "/my-work" },
    { label: "Team", href: "/team" },
    { label: "Pipeline Deals", href: "/deals" },
    { label: "Accounts", href: "/accounts" },
    { label: "Files", href: "/files" },
    { label: "Analytics", href: "/analytics" },
  ],
  director: [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Pipeline Deals", href: "/deals" },
    { label: "Accounts", href: "/accounts" },
    { label: "Reviews", href: "/reviews" },
    { label: "Analytics", href: "/analytics" },
    { label: "Files", href: "/files" },
  ],
  executive: [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Analytics", href: "/analytics" },
    { label: "Pipeline (read)", href: "/deals" },
  ],
  tenant_admin: [
    { label: "Dashboard", href: "/dashboard" },
    { label: "All Deals", href: "/deals" },
    { label: "Accounts", href: "/accounts" },
    { label: "Analytics", href: "/analytics" },
    { label: "Admin", href: "/admin" },
  ],
};

// Fixed order so a multi-role user's merged nav/landing choice is deterministic (docs/01-domain-model.md:
// "a user may hold multiple rows; effective permission is the union" - order isn't specified there,
// this is a reasonable, low-stakes default rather than a product decision).
const ROLE_PRIORITY: readonly Role[] = ["bde", "team_lead", "director", "executive", "tenant_admin"];

// The union of nav items across every role the actor holds, deduplicated by href, in a stable
// order. A user holding both bde and team_lead sees one merged menu, not two.
export function navItemsForRoles(roles: readonly Role[]): NavItem[] {
  const held = new Set(roles);
  const seen = new Set<string>();
  const items: NavItem[] = [];
  for (const role of ROLE_PRIORITY) {
    if (!held.has(role)) continue;
    for (const item of NAV_BY_ROLE[role]) {
      if (seen.has(item.href)) continue;
      seen.add(item.href);
      items.push(item);
    }
  }
  return items;
}

// "My Work is the default landing screen for BDE and Team Lead" (docs/06-ui-spec.md) - the other
// three roles' first nav item (Dashboard) is a reasonable inferred default, not stated explicitly.
export function defaultLandingHref(roles: readonly Role[]): string {
  if (roles.includes("bde") || roles.includes("team_lead")) return "/my-work";
  return "/dashboard";
}

// Route-level access gating: does any role this actor holds include this exact href in its nav?
// This is deliberately coarser than docs/02-permission-matrix.md's can() guard - it answers "may
// this role land on this page at all," not "may they perform action X on record Y" once there.
// /admin is additionally gated by can(actor, 'admin.view_panel') where a precise matrix action
// exists (see app/(app)/admin/page.tsx); most nav destinations have no equivalent single action.
export function rolesAllowedForHref(href: string): Role[] {
  return (Object.keys(NAV_BY_ROLE) as Role[]).filter((role) =>
    NAV_BY_ROLE[role].some((item) => item.href === href),
  );
}
