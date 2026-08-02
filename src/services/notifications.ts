import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "@/auth/permissions";
import { insertNotification, type NewNotificationInput } from "@/data/notifications";
import { getNotificationPreference, listNotificationPreferences, upsertNotificationPreference } from "@/data/notificationPreferences";

// M4.8's per-type preference gate (docs/07-build-backlog.md: "...with per-type user preferences
// replacing coarse toggles"). The single choke point every notification-writing call site should go
// through from here on - wraps insertNotification (src/data/notifications.ts, itself unchanged,
// still a service-role-only write) with a preference check first. It is input.recipientId's own
// preference that gates this, never the actor sending it - opting out of a notification type
// belongs entirely to whoever would receive it, not whoever triggered it.
export async function sendNotification(supabase: SupabaseClient, input: NewNotificationInput): Promise<void> {
  const enabled = await getNotificationPreference(supabase, input.recipientId, input.eventType);
  if (!enabled) return;
  await insertNotification(supabase, input);
}

// Scoped to exactly the four M4.8 covers. docs/01-domain-model.md's own vocabulary names four more
// (comment_added, deal_escalated, deal_reassigned, quota_milestone) - not offered as a toggle here
// since nothing can fire them yet; the same "not invented here" reasoning migration 0011's own
// README entry already used for task_watchers' missing insert policy. `mentioned` is the one
// exception worth calling out: it IS offered below even though nothing fires it yet either -
// task_comments (migration 0011) has no service-layer code at all today, and M4.9 ("Comments,
// watchers and @mention") is what adds the one insertNotification call site that actually sends it.
// The preference model is complete now, by explicit choice; M4.9 only has to add that one call,
// gated the same way the other three already are.
export const NOTIFICATION_EVENT_TYPES = ["task_assigned", "task_reassigned", "task_overdue", "mentioned"] as const;
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEventType, string> = {
  task_assigned: "A task is assigned to me",
  task_reassigned: "A task is reassigned to me",
  task_overdue: "One of my tasks becomes overdue",
  mentioned: "I'm mentioned in a comment",
};

export interface NotificationPreferenceSetting {
  eventType: NotificationEventType;
  label: string;
  enabled: boolean;
}

// For the preferences screen: every type above, defaulting to enabled when the actor has never
// explicitly set a preference for it (getNotificationPreference's own reasoning).
export async function getNotificationPreferences(supabase: SupabaseClient, actor: Actor): Promise<NotificationPreferenceSetting[]> {
  const rows = await listNotificationPreferences(supabase, actor.id);
  const byType = new Map(rows.map((row) => [row.eventType, row.enabled]));
  return NOTIFICATION_EVENT_TYPES.map((eventType) => ({
    eventType,
    label: NOTIFICATION_EVENT_LABELS[eventType],
    enabled: byType.get(eventType) ?? true,
  }));
}

export async function setNotificationPreference(
  supabase: SupabaseClient,
  actor: Actor,
  eventType: NotificationEventType,
  enabled: boolean,
): Promise<void> {
  await upsertNotificationPreference(supabase, actor.tenantId, actor.id, eventType, enabled);
}
