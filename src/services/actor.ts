import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "@/auth/permissions";
import { getActiveRoleGrants } from "@/data/userRoles";
import { getTenantName } from "@/data/tenants";
import { getSessionUser } from "@/services/session";

export type ActorResult =
  | { status: "signed-out" }
  | { status: "suspended" }
  | { status: "active"; actor: Actor; fullName: string; email: string; tenantName: string };

// Bridges the session (M0.3) with the actor's role grants into the exact shape can() (M0.4)
// needs, so the app shell (and any future route that must authorise a specific action) doesn't
// each re-fetch and re-assemble this by hand.
export async function getSessionActor(supabase: SupabaseClient): Promise<ActorResult> {
  const session = await getSessionUser(supabase);
  if (session.status !== "active") return session;

  const [roleGrants, tenantName] = await Promise.all([
    getActiveRoleGrants(supabase, session.user.id),
    getTenantName(supabase, session.user.tenantId),
  ]);

  return {
    status: "active",
    actor: {
      id: session.user.id,
      tenantId: session.user.tenantId,
      status: session.user.status,
      roleGrants,
    },
    fullName: session.user.fullName,
    email: session.user.email,
    tenantName,
  };
}
