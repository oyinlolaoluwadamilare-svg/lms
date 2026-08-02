import { toMajorUnitsString } from "@/domain/money";
import { getDealForEditView } from "@/services/deals";
import { getSessionActor } from "@/services/actor";
import { createClient } from "@/lib/supabase/server";
import { DeniedState } from "@/ui/states/DeniedState";
import { EmptyState } from "@/ui/states/EmptyState";
import { checkRouteAccess } from "../../../_access";
import { EditDealForm } from "./EditDealForm";

export default async function EditDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { allowed } = await checkRouteAccess("/deals");
  if (!allowed) return <DeniedState message="Pipeline is not available for your role." />;

  const { id } = await params;
  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  if (session.status !== "active") {
    return <DeniedState message="Sign in to edit a deal." />;
  }

  const deal = await getDealForEditView(supabase, session.actor, id);
  if (!deal) {
    return <EmptyState title="Deal not found" description="It may not exist, or isn't visible to your role." />;
  }
  if (!deal.canEdit) {
    return <DeniedState message="You don't have permission to edit this deal." />;
  }

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-ink">Edit deal</h1>
      <EditDealForm
        dealId={deal.id}
        name={deal.name}
        clientType={deal.clientType}
        expectedCloseDate={deal.expectedCloseDate ?? ""}
        proposalValue={deal.proposalValueMinor !== null ? toMajorUnitsString(deal.proposalValueMinor) : ""}
        negotiatedValue={deal.negotiatedValueMinor !== null ? toMajorUnitsString(deal.negotiatedValueMinor) : ""}
        brief={deal.brief ?? ""}
      />
    </main>
  );
}
