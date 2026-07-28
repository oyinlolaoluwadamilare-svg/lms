// audit_entries (db/schema.sql). ip_hash, never a raw address (CLAUDE.md #10: "No personal data
// in URLs, query strings, or log lines") - callers pass the raw address in, hashing happens once,
// inside src/services/audit.ts's writeAudit(), so no caller can accidentally store it unhashed.
export interface AuditEntryInput {
  tenantId: string;
  actorId: string | null;
  entityType: string;
  entityId: string | null;
  action: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
}

export interface AuditEntry {
  id: string;
  tenantId: string;
  actorId: string | null;
  entityType: string;
  entityId: string | null;
  action: string;
  before: unknown;
  after: unknown;
  ipHash: string | null;
  occurredAt: string;
}
