import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppUser } from "@/domain/user";
import type { Role } from "@/domain/role";

interface UsersRow {
  id: string;
  tenant_id: string;
  full_name: string;
  email: string;
  status: AppUser["status"];
  timezone: string | null;
}

function toDomain(row: UsersRow): AppUser {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    fullName: row.full_name,
    email: row.email,
    status: row.status,
    timezone: row.timezone,
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
    .select("id, tenant_id, full_name, email, status, timezone")
    .eq("id", authId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new Error(`getUserByAuthId failed: ${error.message}`);
  if (!data) return null;
  return toDomain(data as UsersRow);
}

// For an owner picker on the create-deal form. Scoped by RLS (users_select: tenant-wide read
// within the caller's own tenant) - no additional practice-based narrowing is enforced here or at
// the service layer, since docs/02-permission-matrix.md defines no distinct scope for "who may be
// set as owner at creation" (deal.change_owner, a different action, is a later-in-life concern).
export async function listActiveUsersInTenant(
  supabase: SupabaseClient,
): Promise<Array<Pick<AppUser, "id" | "fullName" | "email">>> {
  const { data, error } = await supabase
    .from("users")
    .select("id, full_name, email")
    .eq("status", "active")
    .is("deleted_at", null)
    .order("full_name");

  if (error) throw new Error(`listActiveUsersInTenant failed: ${error.message}`);
  return (data as Array<{ id: string; full_name: string; email: string }>).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
  }));
}

export interface AssignableUser {
  id: string;
  fullName: string;
  email: string;
  role: Role;
}

interface AssignableUserRow {
  role: Role;
  users: { id: string; full_name: string; email: string; status: AppUser["status"]; deleted_at: string | null } | null;
}

function mapAssignableUserRows(rows: AssignableUserRow[]): AssignableUser[] {
  const seen = new Set<string>();
  const result: AssignableUser[] = [];
  for (const row of rows) {
    const user = row.users;
    if (!user || user.status !== "active" || user.deleted_at !== null || seen.has(user.id)) continue;
    seen.add(user.id);
    result.push({ id: user.id, fullName: user.full_name, email: user.email, role: row.role });
  }
  return result.sort((a, b) => a.fullName.localeCompare(b.fullName));
}

// For the Add Task modal's "scope-filtered" assignee picker (docs/06-ui-spec.md M4.3), when the
// task is linked to a deal: active, non-deleted users holding a working role (bde/team_lead/
// director) in the deal's own practice line, plus any tenant_admin (tenant-wide scope, per
// docs/02-permission-matrix.md's task.assign_to_other row). `executive` is deliberately excluded -
// every task.* action that would let them DO anything with an assigned task (task.complete/
// task.update) is null for that role, so a task assigned to an executive could never be actioned by
// them. This is a UI convenience filter only (CLAUDE.md #1: a filtered picker is never the sole
// control) - src/services/tasks.ts's createTask independently re-checks can() and validates the
// chosen assignee server-side regardless of what this picker offered.
export async function listAssignableUsersForPractice(supabase: SupabaseClient, tenantId: string, practiceLineId: string): Promise<AssignableUser[]> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role, users:users!user_id(id, full_name, email, status, deleted_at)")
    .eq("tenant_id", tenantId)
    .is("revoked_at", null)
    .or(`practice_line_id.eq.${practiceLineId},role.eq.tenant_admin`);

  if (error) throw new Error(`listAssignableUsersForPractice failed: ${error.message}`);
  return mapAssignableUserRows(data as unknown as AssignableUserRow[]);
}

// The deal-less-task counterpart: no practice line to filter by, so every working role
// (bde/team_lead/director/tenant_admin) tenant-wide is offered - the same "no specific record to
// scope against" reasoning src/auth/permissions.ts's can() already applies when this file's
// createTask is called with no deal linked (a resource-less can() check trivially passes for any
// role holding a non-null entry). Not wired to any UI yet - the deal detail page (M4.3) always has
// a deal to scope by; this exists for the my-work/global "Add Task" entry point M4.5 will add.
export async function listAssignableUsersForTenant(supabase: SupabaseClient, tenantId: string): Promise<AssignableUser[]> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role, users:users!user_id(id, full_name, email, status, deleted_at)")
    .eq("tenant_id", tenantId)
    .is("revoked_at", null)
    .neq("role", "executive");

  if (error) throw new Error(`listAssignableUsersForTenant failed: ${error.message}`);
  return mapAssignableUserRows(data as unknown as AssignableUserRow[]);
}
