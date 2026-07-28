import { DeniedState } from "@/ui/states/DeniedState";
import { EmptyState } from "@/ui/states/EmptyState";
import { checkRouteAccess } from "../_access";

export default async function FilesPage() {
  const { allowed } = await checkRouteAccess("/files");
  if (!allowed) return <DeniedState message="Files is not available for your role." />;

  return (
    <EmptyState
      title="No documents to show yet"
      description="Document upload and versioning land later in the backlog."
    />
  );
}
