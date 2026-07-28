import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppUser } from "@/domain/user";

interface UsersRow {
  id: string;
  tenant_id: string;
  full_name: string;
  email: string;
  status: AppUser["status"];
}

function toDomain(row: UsersRow): AppUser {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    fullName: row.full_name,
    email: row.email,
    status: row.status,
  };
}

// Scoped by the caller's own session (RLS policy users_select: tenant_id = current_tenant_id()
// and deleted_at is null). current_tenant_id() itself only resolves for a status = 'active' row,
// so a suspended/inactive/deleted user's own row comes back as zero rows here, not an error - the
// database enforcing invariant #7 (docs/02-permission-matrix.md) independently of this query. The
// explicit .eq("status", "active") below is redundant with that but documents the intent rather
// than relying silently on RLS internals.
export async function getUserByAuthId(
  supabase: SupabaseClient,
  authId: string,
): Promise<AppUser | null> {
  const { data, error } = await supabase
    .from("users")
    .select("id, tenant_id, full_name, email, status")
    .eq("id", authId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new Error(`getUserByAuthId failed: ${error.message}`);
  if (!data) return null;
  return toDomain(data as UsersRow);
}
