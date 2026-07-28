import type { Role } from "@/domain/role";
import { rolesAllowedForHref } from "@/domain/navigation";
import { getCachedActor } from "./_actor";

// Shared by every placeholder page under (app): layout.tsx already redirects a signed-out or
// suspended session away from this whole segment, so what's left for each individual page to
// check is route-level role access (CLAUDE.md #1: hiding a nav link is presentation only, never
// the sole control - a role can still type the URL directly).
export async function checkRouteAccess(href: string): Promise<{ allowed: boolean; roles: Role[] }> {
  const result = await getCachedActor();
  if (result.status !== "active") return { allowed: false, roles: [] };

  const roles = result.actor.roleGrants.map((grant) => grant.role);
  const allowedRoles = rolesAllowedForHref(href);
  return { allowed: roles.some((role) => allowedRoles.includes(role)), roles };
}
