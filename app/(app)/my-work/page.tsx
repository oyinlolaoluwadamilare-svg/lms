import { DeniedState } from "@/ui/states/DeniedState";
import { EmptyState } from "@/ui/states/EmptyState";
import { checkRouteAccess } from "../_access";

export default async function MyWorkPage() {
  const { allowed } = await checkRouteAccess("/my-work");
  if (!allowed) return <DeniedState message="My Work is available to BDE and Team Lead roles." />;

  return (
    <EmptyState
      title="Nothing due"
      description="Tasks land here once the Tasks feature is built (docs/07-build-backlog.md, M2)."
    />
  );
}
