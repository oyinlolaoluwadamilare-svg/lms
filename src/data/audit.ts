import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditEntry } from "@/domain/audit";

interface AuditEntriesRow {
  id: number;
  tenant_id: string;
  actor_id: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  before: unknown;
  after: unknown;
  ip_hash: string | null;
  occurred_at: string;
}

function toDomain(row: AuditEntriesRow): AuditEntry {
  return {
    id: String(row.id),
    tenantId: row.tenant_id,
    actorId: row.actor_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    before: row.before,
    after: row.after,
    ipHash: row.ip_hash,
    occurredAt: row.occurred_at,
  };
}

// A single INSERT is already atomic on its own - no explicit transaction needed here. A future
// caller that must combine this with another write (e.g. a deal update) atomically cannot do so
// by calling this alongside a separate Supabase-client call: PostgREST has no concept of a
// client-side multi-statement transaction. That combination needs a Postgres function performing
// both writes, invoked through a single .rpc() call - not yet needed since no such compound writer
// exists yet (M1+ territory), flagged here so the first one to need it doesn't miss it.
export async function insertAuditEntry(
  serviceClient: SupabaseClient,
  row: {
    tenant_id: string;
    actor_id: string | null;
    entity_type: string;
    entity_id: string | null;
    action: string;
    before?: unknown;
    after?: unknown;
    ip_hash: string | null;
  },
): Promise<AuditEntry> {
  const { data, error } = await serviceClient
    .from("audit_entries")
    .insert(row)
    .select("id, tenant_id, actor_id, entity_type, entity_id, action, before, after, ip_hash, occurred_at")
    .single();

  if (error) throw new Error(`insertAuditEntry failed: ${error.message}`);
  return toDomain(data as AuditEntriesRow);
}
