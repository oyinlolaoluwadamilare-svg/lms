import { formatMoney } from "@/domain/money";
import { getDealDetail } from "@/services/deals";
import { createClient } from "@/lib/supabase/server";
import { DeniedState } from "@/ui/states/DeniedState";
import { EmptyState } from "@/ui/states/EmptyState";
import { checkRouteAccess } from "../../_access";

const STAGE_TYPE_LABEL: Record<string, string> = { open: "Open", won: "Won", lost: "Lost" };

export default async function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { allowed } = await checkRouteAccess("/deals");
  if (!allowed) return <DeniedState message="Pipeline is not available for your role." />;

  const { id } = await params;
  const supabase = await createClient();
  // getDealDetail reads through this caller's own RLS-scoped session (migration 0005's
  // deals_select policy) - null means either the deal doesn't exist or this actor can't see it,
  // deliberately not distinguished (same reasoning as changeStage's not_found case).
  const deal = await getDealDetail(supabase, id);

  if (!deal) {
    return <EmptyState title="Deal not found" description="It may not exist, or isn't visible to your role." />;
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 rounded-token border border-line bg-raised p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-ink">{deal.name}</h1>
          <span className="rounded-token bg-surface px-2 py-0.5 text-xs font-medium text-muted">{deal.reference}</span>
          <span className="rounded-token bg-accent px-2 py-0.5 text-xs font-medium text-surface">{deal.stage.name}</span>
        </div>
        <p className="text-sm text-muted">{deal.account.name}</p>
      </header>

      {/* Deliberately no next-action strip, last-engaged chip, primary action buttons (Log
          Activity, Add Task, Edit Deal, Advance Stage, Mark Won/Lost, Escalate, Add Contact),
          engagement timeline, stakeholders or open tasks here - docs/06-ui-spec.md's full Deal
          detail spec includes all of these, but every one depends on an entity or action that
          doesn't exist yet (activities: M3+; tasks: M4+; edit: M1.7; mark won/lost: M5.2-M5.3).
          This is the read-only skeleton docs/07-build-backlog.md M1.6 asks for: header, financial
          summary, details, account - nothing rendered here would actually do anything yet. */}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-token border border-line bg-raised p-6">
          <h2 className="text-sm font-semibold text-ink">Financial summary</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Proposal value</dt>
            <dd className="text-ink">{deal.proposalValue ? formatMoney(deal.proposalValue) : "—"}</dd>
            <dt className="text-muted">Negotiated value</dt>
            <dd className="text-ink">{deal.negotiatedValue ? formatMoney(deal.negotiatedValue) : "—"}</dd>
            <dt className="text-muted">Probability</dt>
            <dd className="text-ink">{deal.probability}%</dd>
            <dt className="text-muted">Weighted forecast</dt>
            <dd className="text-ink">{deal.weightedValue ? formatMoney(deal.weightedValue) : "—"}</dd>
            <dt className="text-muted">Forecast category</dt>
            <dd className="capitalize text-ink">{deal.forecastCategory.replace("_", " ")}</dd>
          </dl>
        </section>

        <section className="flex flex-col gap-3 rounded-token border border-line bg-raised p-6">
          <h2 className="text-sm font-semibold text-ink">Details</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Owner</dt>
            <dd className="text-ink">{deal.ownerName ?? "Unowned"}</dd>
            <dt className="text-muted">Co-owners</dt>
            <dd className="text-ink">{deal.coOwnerNames.length ? deal.coOwnerNames.join(", ") : "—"}</dd>
            <dt className="text-muted">Author</dt>
            <dd className="text-ink">{deal.authorName}</dd>
            <dt className="text-muted">Practice line</dt>
            <dd className="text-ink">{deal.practiceLineName}</dd>
            <dt className="text-muted">Client type</dt>
            <dd className="capitalize text-ink">{deal.clientType}</dd>
            <dt className="text-muted">Status</dt>
            <dd className="capitalize text-ink">{deal.status.replace("_", " ")}</dd>
            <dt className="text-muted">Stage type</dt>
            <dd className="text-ink">{STAGE_TYPE_LABEL[deal.stage.stageType] ?? deal.stage.stageType}</dd>
            <dt className="text-muted">Expected close</dt>
            <dd className="text-ink">{deal.expectedCloseDate ?? "—"}</dd>
            <dt className="text-muted">Actual close</dt>
            <dd className="text-ink">{deal.actualCloseDate ?? "—"}</dd>
          </dl>
          {deal.brief ? (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-muted">Brief</p>
              <p className="text-sm text-ink">{deal.brief}</p>
            </div>
          ) : null}
        </section>

        <section className="flex flex-col gap-3 rounded-token border border-line bg-raised p-6 md:col-span-2">
          <h2 className="text-sm font-semibold text-ink">Account</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-4">
            <dt className="text-muted">Name</dt>
            <dd className="text-ink">{deal.account.name}</dd>
            <dt className="text-muted">Industry</dt>
            <dd className="text-ink">{deal.account.industry ?? "—"}</dd>
            <dt className="text-muted">Region</dt>
            <dd className="text-ink">{deal.account.region ?? "—"}</dd>
          </dl>
        </section>
      </div>
    </div>
  );
}
