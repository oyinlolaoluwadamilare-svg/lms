import { DeniedState } from "@/ui/states/DeniedState";
import { EmptyState } from "@/ui/states/EmptyState";
import { checkRouteAccess } from "../_access";

export default async function DashboardPage() {
  const { allowed } = await checkRouteAccess("/dashboard");
  if (!allowed) return <DeniedState message="Dashboard is not available for your role." />;

  return (
    <EmptyState
      title="No dashboard data to show yet"
      description="This screen lands with the analytics milestones later in the backlog."
    />
  );
}
