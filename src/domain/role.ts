export type Role = "tenant_admin" | "executive" | "director" | "team_lead" | "bde";

export interface RoleGrant {
  role: Role;
  // null for tenant-wide roles (tenant_admin, executive); non-null for practice-scoped roles
  // (director, team_lead, bde) - matches the role_scope_valid constraint in
  // db/migrations/0003_rls_foundation.up.sql.
  practiceLineId: string | null;
}
