"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionActor } from "@/services/actor";
import { NOTIFICATION_EVENT_TYPES, setNotificationPreference, type NotificationEventType } from "@/services/notifications";

export type SetNotificationPreferenceActionResult = { ok: true } | { ok: false; message: string };

// Plain-arguments server action, the same shape every other client-driven action in this codebase
// already established (completeTaskAction, addTaskAction, ...). eventType is re-validated against
// the known set here rather than trusted as a NotificationEventType from the client - the client
// component only ever renders these four, but a server action is a public endpoint regardless of
// what UI happens to call it (CLAUDE.md #1: server-side authorisation, and validation, always).
export async function setNotificationPreferenceAction(eventType: string, enabled: boolean): Promise<SetNotificationPreferenceActionResult> {
  if (!(NOTIFICATION_EVENT_TYPES as readonly string[]).includes(eventType)) {
    return { ok: false, message: "Unknown notification type." };
  }

  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  if (session.status !== "active") return { ok: false, message: "Your session has expired. Sign in again." };

  await setNotificationPreference(supabase, session.actor, eventType as NotificationEventType, enabled);
  return { ok: true };
}
