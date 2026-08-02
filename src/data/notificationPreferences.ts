import type { SupabaseClient } from "@supabase/supabase-js";

export interface NotificationPreferenceRow {
  eventType: string;
  enabled: boolean;
}

// M4.8 (docs/07-build-backlog.md): "...with per-type user preferences replacing coarse toggles."
// Default is ON - a MISSING row means "enabled" (migration 0014's own header comment explains why:
// a user only gets a row once they've actually turned a preference off, or back on after that). A
// caller checking whether a SPECIFIC notification should be sent must treat an absent row as true,
// never as "unknown" or an error.
export async function getNotificationPreference(supabase: SupabaseClient, userId: string, eventType: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("notification_preferences")
    .select("enabled")
    .eq("user_id", userId)
    .eq("event_type", eventType)
    .maybeSingle();

  if (error) throw new Error(`getNotificationPreference failed: ${error.message}`);
  return data?.enabled ?? true;
}

// For the preferences screen - only the rows a user has actually set; anything absent defaults to
// enabled, per getNotificationPreference's own reasoning above.
export async function listNotificationPreferences(supabase: SupabaseClient, userId: string): Promise<NotificationPreferenceRow[]> {
  const { data, error } = await supabase.from("notification_preferences").select("event_type, enabled").eq("user_id", userId);

  if (error) throw new Error(`listNotificationPreferences failed: ${error.message}`);
  return (data as Array<{ event_type: string; enabled: boolean }>).map((row) => ({ eventType: row.event_type, enabled: row.enabled }));
}

// Scoped by the caller's OWN RLS-scoped client, never service-role - migration 0014's
// notification_preferences_upsert/_update policies exist specifically so a user can manage their
// own preferences directly, the same self-service shape notifications_mark_read already
// established for "mark my own notification read."
export async function upsertNotificationPreference(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
  eventType: string,
  enabled: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("notification_preferences")
    .upsert({ tenant_id: tenantId, user_id: userId, event_type: eventType, enabled }, { onConflict: "user_id,event_type" });

  if (error) throw new Error(`upsertNotificationPreference failed: ${error.message}`);
}
