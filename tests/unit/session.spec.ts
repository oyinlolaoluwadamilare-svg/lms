import { describe, expect, it, vi } from "vitest";
import { getSessionUser } from "../../src/services/session";

// Mocks only the Supabase surface getSessionUser and getUserByAuthId actually touch: auth.getUser,
// auth.signOut, and the from().select().eq().eq().is().maybeSingle() chain. Full RLS-backed
// behaviour (a suspended user's own row really coming back as zero rows) is proven at the database
// layer by tests/rls, not re-asserted here - this test is only for the discriminator logic in
// src/services/session.ts, which is what decides "suspended" vs "signed-out" vs "active" (invariant
// #7, docs/02-permission-matrix.md).
function makeSupabase(options: {
  authUser: { id: string } | null;
  usersRow: { id: string; tenant_id: string; full_name: string; email: string; status: string } | null;
}) {
  const signOut = vi.fn().mockResolvedValue({ error: null });
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: options.usersRow, error: null }),
  };
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: options.authUser } }),
      signOut,
    },
    from: vi.fn().mockReturnValue(chain),
    _signOut: signOut,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("getSessionUser", () => {
  it("returns signed-out when there is no Supabase Auth session at all", async () => {
    const supabase = makeSupabase({ authUser: null, usersRow: null });
    const result = await getSessionUser(supabase);
    expect(result).toEqual({ status: "signed-out" });
    expect(supabase._signOut).not.toHaveBeenCalled();
  });

  it("returns suspended and signs out when the auth session has no matching active users row", async () => {
    const supabase = makeSupabase({ authUser: { id: "user-1" }, usersRow: null });
    const result = await getSessionUser(supabase);
    expect(result).toEqual({ status: "suspended" });
    expect(supabase._signOut).toHaveBeenCalledOnce();
  });

  it("returns active with the mapped user when a matching active row exists", async () => {
    const supabase = makeSupabase({
      authUser: { id: "user-1" },
      usersRow: {
        id: "user-1",
        tenant_id: "tenant-1",
        full_name: "Ada Lovelace",
        email: "ada@example.com",
        status: "active",
      },
    });
    const result = await getSessionUser(supabase);
    expect(result).toEqual({
      status: "active",
      user: {
        id: "user-1",
        tenantId: "tenant-1",
        fullName: "Ada Lovelace",
        email: "ada@example.com",
        status: "active",
      },
    });
    expect(supabase._signOut).not.toHaveBeenCalled();
  });
});
