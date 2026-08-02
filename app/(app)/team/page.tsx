import { getTeamOverview } from "@/services/tasks";
import { createClient } from "@/lib/supabase/server";
import { getCachedActor } from "../_actor";
import { checkRouteAccess } from "../_access";
import { DeniedState } from "@/ui/states/DeniedState";
import { EmptyState } from "@/ui/states/EmptyState";
import { WorkTabs } from "@/ui/nav/WorkTabs";

const ROLE_LABEL: Record<string, string> = { bde: "BDE", team_lead: "Team Lead", director: "Director" };

// docs/07-build-backlog.md M4.6: "Team view for Team Lead and Director with per-person open,
// overdue and completed counts." src/services/tasks.ts's getTeamOverview own comment explains the
// scope (the actor's own practice line(s), not tenant-wide) and the "completed recently" judgment
// call (a rolling 7-day window, no doc specifies one). Deal-less personal tasks belonging to
// someone OTHER than the viewer are invisible here (tasks_select's own RLS scope, not a gap this
// page introduces) - counts reflect what the viewer's own session can actually see, the same
// honesty this codebase's every other RLS-scoped read already has.
export default async function TeamPage() {
  const { allowed } = await checkRouteAccess("/team");
  if (!allowed) return <DeniedState message="Team is available to Team Lead and Director roles." />;

  const session = await getCachedActor();
  if (session.status !== "active") return <DeniedState message="Your session has expired. Sign in again." />;

  const supabase = await createClient();
  const overview = await getTeamOverview(supabase, session.actor, session.timezone);

  if (!overview.ok) return <DeniedState message="Team is available to Team Lead and Director roles." />;

  return (
    <div className="flex flex-col gap-6">
      <WorkTabs active="team" showTeamTab={true} />

      {overview.members.length === 0 ? (
        <EmptyState title="No team members yet" description="No one else holds a role in your practice line." />
      ) : (
        <section className="rounded-token border border-line bg-raised p-6">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs font-medium text-muted">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Role</th>
                  <th className="py-2 pr-4">Open</th>
                  <th className="py-2 pr-4">Overdue</th>
                  <th className="py-2 pr-4">Completed (last 7 days)</th>
                </tr>
              </thead>
              <tbody>
                {overview.members.map((member) => (
                  <tr key={member.id} className="border-b border-line last:border-b-0">
                    <td className="py-2 pr-4 font-medium text-ink">{member.fullName}</td>
                    <td className="py-2 pr-4 text-muted">{ROLE_LABEL[member.role] ?? member.role}</td>
                    <td className="py-2 pr-4 text-ink">{member.open}</td>
                    <td className={`py-2 pr-4 font-medium ${member.overdue > 0 ? "text-lost" : "text-ink"}`}>{member.overdue}</td>
                    <td className="py-2 pr-4 text-ink">{member.completedRecently}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
