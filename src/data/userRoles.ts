import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoleGrant } from "@/domain/role";

interface UserRolesRow {
  role: RoleGrant["role"];
  practice_line_id: string | null;
}

// Scoped by RLS (user_roles_select: tenant_id = current_tenant_id(), tenant-wide read - role
// visibility is coarse-grained, not itself sensitive, per db/migrations/0003_rls_foundation.up.sql).
export async function getActiveRoleGrants(supabase: SupabaseClient, userId: string): Promise<RoleGrant[]> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role, practice_line_id")
    .eq("user_id", userId)
    .is("revoked_at", null);

  if (error) throw new Error(`getActiveRoleGrants failed: ${error.message}`);
  return (data as UserRolesRow[]).map((row) => ({ role: row.role, practiceLineId: row.practice_line_id }));
}
