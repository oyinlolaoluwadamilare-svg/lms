import { DeniedState } from "@/ui/states/DeniedState";
import { EmptyState } from "@/ui/states/EmptyState";
import { checkRouteAccess } from "../_access";

export default async function BusinessLinesPage() {
  const { allowed } = await checkRouteAccess("/business-lines");
  if (!allowed) return <DeniedState message="Business Lines is available to the BDE role." />;

  return (
    <EmptyState
      title="No practice lines to show yet"
      description="This screen lands with the practice-line features in M1 onward."
    />
  );
}
