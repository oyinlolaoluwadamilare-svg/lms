import type { SupabaseClient } from "@supabase/supabase-js";

export interface NewNotificationInput {
  tenantId: string;
  recipientId: string;
  actorId: string | null;
  eventType: string;
  entityType: string;
  entityId: string | null;
  title: string;
  body?: string | null;
}

// notifications has no insert policy for `authenticated` at all (migration 0012) - every
// notification is a side effect of some OTHER privileged write, delivered via a service-role
// client, the same shape writeAudit already uses for audit_entries.
export async function insertNotification(serviceClient: SupabaseClient, input: NewNotificationInput): Promise<void> {
  const { error } = await serviceClient.from("notifications").insert({
    tenant_id: input.tenantId,
    recipient_id: input.recipientId,
    actor_id: input.actorId,
    event_type: input.eventType,
    entity_type: input.entityType,
    entity_id: input.entityId,
    title: input.title,
    body: input.body ?? null,
  });

  if (error) throw new Error(`insertNotification failed: ${error.message}`);
}
