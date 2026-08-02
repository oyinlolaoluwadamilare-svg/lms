import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { countActiveDealsWithoutNextAction } from "@/services/deals";
import { checkRouteAccess } from "../_access";
import { DeniedState } from "@/ui/states/DeniedState";

// M4.7 (docs/07-build-backlog.md): "dashboard tile listing active deals lacking an open task."
// This is the first tile the dashboard has ever had (a bare stub before this) - the real analytics
// build (M6) is where a general tile/grid pattern would earn its keep; one tile doesn't, so this is
// plain JSX, not an abstraction. The count itself is the exact complement of
// docs/04-metric-definitions.md's "Next-action coverage" metric - see
// src/data/deals.ts's countDealsWithoutNextAction for why status = 'active' is folded in rather
// than just checking next_action_task_id. Read through the caller's own RLS-scoped session (no
// service-role client), so a Director sees their own practice's count while an Executive or
// tenant_admin sees the tenant-wide count - exactly matching what the Pipeline list itself would
// show them with the same filter applied, since both go through the identical deals_select policy.
export default async function DashboardPage() {
  const { allowed } = await checkRouteAccess("/dashboard");
  if (!allowed) return <DeniedState message="Dashboard is not available for your role." />;

  const supabase = await createClient();
  const noNextStepCount = await countActiveDealsWithoutNextAction(supabase);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/deals?noNextStep=1"
        prefetch={false}
        className="flex max-w-xs flex-col gap-1 rounded-token border border-line bg-raised p-6 outline-none transition hover:border-accent focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="text-sm font-medium text-muted">No next step</span>
        <span className={`text-3xl font-semibold ${noNextStepCount > 0 ? "text-risk" : "text-ink"}`}>{noNextStepCount}</span>
        <span className="text-sm text-muted">Active deals lacking an open task</span>
      </Link>
    </div>
  );
}
