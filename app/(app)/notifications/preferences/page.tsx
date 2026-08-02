import { createClient } from "@/lib/supabase/server";
import { getCachedActor } from "../../_actor";
import { DeniedState } from "@/ui/states/DeniedState";
import { getNotificationPreferences } from "@/services/notifications";
import { PreferenceToggle } from "./PreferenceToggle";

// M4.8 (docs/07-build-backlog.md): "...with per-type user preferences replacing coarse toggles."
// A personal settings screen, not a role-gated one - every signed-in user manages their own
// notification preferences, so this route has no checkRouteAccess call the way every other (app)
// page has; it isn't in src/domain/navigation.ts's per-role NAV_BY_ROLE for the same reason (it's
// reachable from AppShell's own persistent footer link, next to Sign out, regardless of role).
export default async function NotificationPreferencesPage() {
  const session = await getCachedActor();
  if (session.status !== "active") return <DeniedState message="Your session has expired. Sign in again." />;

  const supabase = await createClient();
  const preferences = await getNotificationPreferences(supabase, session.actor);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Notification preferences</h1>
        <p className="text-sm text-muted">Choose which notifications you want to receive. All are on by default.</p>
      </div>

      <section className="max-w-md rounded-token border border-line bg-raised p-6">
        {preferences.map((preference) => (
          <PreferenceToggle
            key={preference.eventType}
            eventType={preference.eventType}
            label={preference.label}
            initialEnabled={preference.enabled}
          />
        ))}
      </section>
    </div>
  );
}
