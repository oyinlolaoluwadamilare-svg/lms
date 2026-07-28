import { DeniedState } from "@/ui/states/DeniedState";
import { EmptyState } from "@/ui/states/EmptyState";
import { checkRouteAccess } from "../_access";

export default async function AccountsPage() {
  const { allowed } = await checkRouteAccess("/accounts");
  if (!allowed) return <DeniedState message="Accounts is not available for your role." />;

  return (
    <EmptyState
      title="No accounts to show yet"
      description="Accounts and Account 360 land with M4 (docs/07-build-backlog.md)."
    />
  );
}
