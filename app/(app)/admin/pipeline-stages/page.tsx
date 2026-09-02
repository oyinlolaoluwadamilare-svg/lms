import { can } from "@/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getCachedActor } from "../../_actor";
import { DeniedState } from "@/ui/states/DeniedState";
import { getStagesForAdmin } from "@/services/pipelineStages";
import { PipelineStagesAdmin } from "./PipelineStagesAdmin";

// M6.3 (docs/07-build-backlog.md): "Time in stage with median headline; bottleneck highlighting."
// Gated through can() directly, mirroring app/(app)/admin/outcome-reasons/page.tsx's own exact
// shape - checkRouteAccess only resolves exact hrefs already present in
// src/domain/navigation.ts's NAV_BY_ROLE, and this sub-route isn't one.
export default async function PipelineStagesAdminPage() {
  const session = await getCachedActor();
  if (session.status !== "active" || !can(session.actor, "admin.manage_stages")) {
    return <DeniedState message="Pipeline Stages is available to the Tenant Admin role." />;
  }

  const supabase = await createClient();
  const result = await getStagesForAdmin(supabase, session.actor);
  if (!result.ok) return <DeniedState message="Pipeline Stages is available to the Tenant Admin role." />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Pipeline Stages</h1>
        <p className="text-sm text-muted">
          Set a bottleneck threshold for each open stage - the Time in stage analytics panel flags a stage whenever its median time
          exceeds the number of days set here. Leave a stage blank to never flag it.
        </p>
      </div>
      <PipelineStagesAdmin stages={result.stages} />
    </div>
  );
}
