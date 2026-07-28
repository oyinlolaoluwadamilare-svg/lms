import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserByAuthId } from "@/data/users";
import type { AppUser } from "@/domain/user";

export type SessionResult =
  | { status: "signed-out" }
  | { status: "suspended" }
  | { status: "active"; user: AppUser };

// The single path for resolving "who is making this request, and are they allowed to be here."
// auth.getUser() revalidates the session against Supabase Auth (never trusts the cookie alone).
// A Supabase Auth session with no matching active app-level users row (suspended, inactive,
// soft-deleted, or never provisioned) is treated as denied and the session is torn down - see
// getUserByAuthId for why the database, not this function, is what actually enforces that.
export async function getSessionUser(supabase: SupabaseClient): Promise<SessionResult> {
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) return { status: "signed-out" };

  const appUser = await getUserByAuthId(supabase, authUser.id);
  if (!appUser) {
    await supabase.auth.signOut();
    return { status: "suspended" };
  }

  return { status: "active", user: appUser };
}
