import { DeniedState } from "@/ui/states/DeniedState";
import { EmptyState } from "@/ui/states/EmptyState";
import { checkRouteAccess } from "../_access";

export default async function AnalyticsPage() {
  const { allowed } = await checkRouteAccess("/analytics");
  if (!allowed) return <DeniedState message="Analytics is not available for your role." />;

  return (
    <EmptyState
      title="No analytics to show yet"
      description="Analytics panels land with M7 (docs/07-build-backlog.md)."
    />
  );
}
