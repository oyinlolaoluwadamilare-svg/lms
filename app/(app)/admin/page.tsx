import Link from "next/link";
import { can } from "@/auth/permissions";
import { DeniedState } from "@/ui/states/DeniedState";
import { getCachedActor } from "../_actor";

// The one nav destination with a precise matching docs/02-permission-matrix.md action
// (admin.view_panel) - gated through can() directly rather than the coarser nav-derived check
// every other placeholder page uses, since a real, exact authorisation rule already exists for it.
//
// docs/06-ui-spec.md's Admin screen names eight tabs (Pipeline Stages, Practice Lines, Custom
// Fields, Roles & Permissions, Outcome Reasons, Automation Rules, Audit Log, Data & Backup) - M5.1
// was the first of them actually built, M6.3 the second (Pipeline Stages, narrowly - see that
// screen's own comment for what it deliberately does not yet cover: renaming, reordering, creating
// or deactivating a stage). Team Assignments (M6.5) isn't one of the eight named tabs at all - it's
// a new admin concept this milestone introduced (migration 0021's manager_id), closest in spirit to
// the still-unbuilt "Roles & Permissions" tab but narrower and purpose-built for one thing
// (Engagement analytics' own "team" scope), not a placeholder for that whole future tab. Rather than
// a full tab-bar shell for the remaining unbuilt sections (premature abstraction for sections
// nothing has designed yet), this stays a plain link list.
export default async function AdminPage() {
  const result = await getCachedActor();
  if (result.status !== "active" || !can(result.actor, "admin.view_panel")) {
    return <DeniedState message="Admin is available to the Tenant Admin role." />;
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-ink">Admin</h1>
      <ul className="flex flex-col gap-2">
        <li>
          <Link href="/admin/outcome-reasons" prefetch={false} className="text-sm font-medium text-accent underline-offset-2 hover:underline">
            Outcome Reasons
          </Link>
        </li>
        <li>
          <Link href="/admin/pipeline-stages" prefetch={false} className="text-sm font-medium text-accent underline-offset-2 hover:underline">
            Pipeline Stages
          </Link>
        </li>
        <li>
          <Link href="/admin/team-assignments" prefetch={false} className="text-sm font-medium text-accent underline-offset-2 hover:underline">
            Team Assignments
          </Link>
        </li>
        <li className="text-sm text-muted">
          Practice Lines, Custom Fields, Roles &amp; Permissions, Automation Rules, Audit Log, and Data &amp; Backup land later in the
          backlog.
        </li>
      </ul>
    </div>
  );
}
