import { can } from "@/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getSessionActor } from "@/services/actor";
import { getCreateDealFormOptions } from "@/services/deals";
import { DeniedState } from "@/ui/states/DeniedState";
import { CreateDealForm } from "./CreateDealForm";

export default async function NewDealPage() {
  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  if (session.status !== "active") {
    return <DeniedState message="Sign in to create a deal." />;
  }

  // Resource-less check: is deal.create possible in principle for any practice this actor holds a
  // role in? The precise per-practice-line check happens again inside the service on submit
  // (src/services/deals.ts) - this is only about whether to show the form at all.
  if (!can(session.actor, "deal.create")) {
    return <DeniedState message="Creating a deal is not available for your role." />;
  }

  const { accounts, practiceLines, stages, owners } = await getCreateDealFormOptions(supabase);

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-ink">New deal</h1>
      <CreateDealForm
        accounts={accounts.map((a) => ({ id: a.id, label: a.name }))}
        practiceLines={practiceLines.map((p) => ({ id: p.id, label: p.name }))}
        stages={stages.map((s) => ({ id: s.id, label: s.name }))}
        owners={owners.map((o) => ({ id: o.id, label: `${o.fullName} (${o.email})` }))}
        defaultStageId={stages[0]?.id}
      />
    </main>
  );
}
