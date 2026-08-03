import { can } from "@/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getCachedActor } from "../../_actor";
import { DeniedState } from "@/ui/states/DeniedState";
import { getOutcomeReasons } from "@/services/outcomeReasons";
import { OutcomeReasonsAdmin } from "./OutcomeReasonsAdmin";

// M5.1 (docs/07-build-backlog.md): "`outcome_reasons` admin configuration." Gated through can()
// directly, the same precise-action shape app/(app)/admin/page.tsx's own comment explains ("the
// one nav destination with a precise matching docs/02-permission-matrix.md action... rather than
// the coarser nav-derived check") - checkRouteAccess only resolves EXACT hrefs already present in
// src/domain/navigation.ts's NAV_BY_ROLE, and this sub-route isn't (and doesn't need to be) one.
export default async function OutcomeReasonsAdminPage() {
  const session = await getCachedActor();
  if (session.status !== "active" || !can(session.actor, "admin.manage_outcome_reasons")) {
    return <DeniedState message="Outcome Reasons is available to the Tenant Admin role." />;
  }

  const supabase = await createClient();
  const result = await getOutcomeReasons(supabase, session.actor);
  if (!result.ok) return <DeniedState message="Outcome Reasons is available to the Tenant Admin role." />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Outcome Reasons</h1>
        <p className="text-sm text-muted">Configure the win and loss reasons offered when a deal is closed.</p>
      </div>
      <OutcomeReasonsAdmin reasons={result.reasons} />
    </div>
  );
}
