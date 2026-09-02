import { can } from "@/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getCachedActor } from "../../_actor";
import { DeniedState } from "@/ui/states/DeniedState";
import { getTeamAssignments } from "@/services/teamAssignments";
import { TeamAssignmentsAdmin } from "./TeamAssignmentsAdmin";

// M6.5 (docs/07-build-backlog.md): "Engagement analytics... all role-scoped." Gated through can()
// directly, mirroring app/(app)/admin/pipeline-stages/page.tsx's own exact shape - checkRouteAccess
// only resolves exact hrefs already present in src/domain/navigation.ts's NAV_BY_ROLE, and this
// sub-route isn't one.
export default async function TeamAssignmentsAdminPage() {
  const session = await getCachedActor();
  if (session.status !== "active" || !can(session.actor, "admin.assign_role")) {
    return <DeniedState message="Team Assignments is available to the Tenant Admin role." />;
  }

  const supabase = await createClient();
  const result = await getTeamAssignments(supabase, session.actor);
  if (!result.ok) return <DeniedState message="Team Assignments is available to the Tenant Admin role." />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Team Assignments</h1>
        <p className="text-sm text-muted">
          Assign each BDE to the Team Lead they report to - this defines &quot;team&quot; for Engagement analytics on the Analytics page.
          Leave a row unassigned and that BDE simply isn&apos;t on anyone&apos;s team roster yet.
        </p>
      </div>
      <TeamAssignmentsAdmin assignments={result.assignments} teamLeadsByPracticeLineId={result.teamLeadsByPracticeLineId} />
    </div>
  );
}
