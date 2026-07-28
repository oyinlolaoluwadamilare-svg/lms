import { can } from "@/auth/permissions";
import { DeniedState } from "@/ui/states/DeniedState";
import { EmptyState } from "@/ui/states/EmptyState";
import { getCachedActor } from "../_actor";

// The one nav destination with a precise matching docs/02-permission-matrix.md action
// (admin.view_panel) - gated through can() directly rather than the coarser nav-derived check
// every other placeholder page uses, since a real, exact authorisation rule already exists for it.
export default async function AdminPage() {
  const result = await getCachedActor();
  if (result.status !== "active" || !can(result.actor, "admin.view_panel")) {
    return <DeniedState message="Admin is available to the Tenant Admin role." />;
  }

  return (
    <EmptyState
      title="No admin settings to show yet"
      description="Stage/practice-line/custom-field management lands later in the backlog."
    />
  );
}
