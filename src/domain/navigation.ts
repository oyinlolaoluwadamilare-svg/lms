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
    // "Team" (M4.6, docs/07-build-backlog.md: "Team view for Team Lead and Director...") is added
    // here even though docs/06-ui-spec.md's own "Navigation, per role" table lists Director's nav
    // as "Dashboard · Pipeline Deals · Accounts · Reviews · Analytics · Files" with no Team entry
    // at all - a genuine inconsistency between that table and the backlog line explicitly naming
    // Director. Asked via AskUserQuestion; unanswered, so the recommended default was taken: treat
    // the table as an incomplete transcription (a gap, not a deliberate exclusion) and extend it
    // with the same /team entry Team Lead already has, rather than leaving Director's own explicit
    // backlog requirement unfulfilled.
    { label: "Team", href: "/team" },
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
    // M5.8 (docs/07-build-backlog.md: "Account 360 screen"): docs/02-permission-matrix.md gives
    // Executive tenant-wide account.view, but docs/06-ui-spec.md's own "Navigation, per role" table
    // lists Executive's nav as "Dashboard · Analytics · Pipeline (read)" with no Accounts entry at
    // all - the same shape of table/permission mismatch already found and defaulted once before for
    // Director's missing "Team" entry (see that entry's own comment above). Asked via
    // AskUserQuestion; the product owner confirmed treating the table as an incomplete
    // transcription and adding this entry, consistent with Executive's own tenant-wide account.view.
    { label: "Accounts", href: "/accounts" },
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
