import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertAuditEntry } from "@/data/audit";
import { createServiceClient } from "@/lib/supabase/service";
import type { AuditEntry, AuditEntryInput } from "@/domain/audit";

function hashIp(ipAddress: string): string {
  return createHash("sha256").update(ipAddress).digest("hex");
}

// The single path for writing an audit entry (CLAUDE.md #6: "Every state change writes an audit
// row. No exceptions for 'minor' fields.") - every future service that mutates a record must call
// this, never insert into audit_entries any other way. Uses the service_role client internally
// (db/schema.sql: audit_entries has no insert policy at all for the `authenticated` role) so a
// caller never needs its own service-role client just to log an event.
//
// A single row insert is already atomic. When a future compound write (e.g. changeStage: update a
// deal, insert a stage_events row, and this) must succeed or fail together, that combination needs
// a Postgres function called through one .rpc() - PostgREST has no client-side transaction that
// could span a separate call to this function and a separate call to the business write. Not
// needed yet (M1+), flagged in src/data/audit.ts too.
export async function writeAudit(
  input: AuditEntryInput,
  serviceClient: SupabaseClient = createServiceClient(),
): Promise<AuditEntry> {
  return insertAuditEntry(serviceClient, {
    tenant_id: input.tenantId,
    actor_id: input.actorId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    action: input.action,
    before: input.before,
    after: input.after,
    ip_hash: input.ipAddress ? hashIp(input.ipAddress) : null,
  });
}
