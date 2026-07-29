import { can } from "@/auth/permissions";
import { DeniedState } from "@/ui/states/DeniedState";
import { EmptyState } from "@/ui/states/EmptyState";
import { getCachedActor } from "../_actor";
import { checkRouteAccess } from "../_access";

export default async function DealsPage() {
  const { allowed } = await checkRouteAccess("/deals");
  if (!allowed) return <DeniedState message="Pipeline is not available for your role." />;

  const result = await getCachedActor();
  const canCreate = result.status === "active" && can(result.actor, "deal.create");

  return (
    <EmptyState
      title="No deals to show yet"
      description="The pipeline board and deal list land with M1 (docs/07-build-backlog.md)."
      action={canCreate ? { label: "New deal", href: "/deals/new" } : undefined}
    />
  );
}
