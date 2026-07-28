import { DeniedState } from "@/ui/states/DeniedState";
import { EmptyState } from "@/ui/states/EmptyState";
import { checkRouteAccess } from "../_access";

export default async function TeamPage() {
  const { allowed } = await checkRouteAccess("/team");
  if (!allowed) return <DeniedState message="Team is available to the Team Lead role." />;

  return (
    <EmptyState
      title="No team activity to show yet"
      description="Per-person open/overdue/completed counts land with the Tasks feature (M2)."
    />
  );
}
