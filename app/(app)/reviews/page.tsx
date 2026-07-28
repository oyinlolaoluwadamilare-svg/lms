import { DeniedState } from "@/ui/states/DeniedState";
import { EmptyState } from "@/ui/states/EmptyState";
import { checkRouteAccess } from "../_access";

export default async function ReviewsPage() {
  const { allowed } = await checkRouteAccess("/reviews");
  if (!allowed) return <DeniedState message="Reviews is available to the Director role." />;

  return (
    <EmptyState title="No reviews to show yet" description="This screen lands later in the backlog." />
  );
}
