export type UserStatus = "active" | "pending" | "suspended" | "inactive";

export interface AppUser {
  id: string;
  tenantId: string;
  fullName: string;
  email: string;
  status: UserStatus;
  timezone: string | null;
}
