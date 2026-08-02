import Link from "next/link";
import { formatMoney } from "@/domain/money";
import { ACTIVITY_TYPE_LABELS } from "@/domain/activity";
import { formatDateInTimezone, formatDurationSeconds, formatPlainDate } from "@/lib/dates";
import { getDealDetail, getDealForEditView } from "@/services/deals";
import { getSessionActor } from "@/services/actor";
import { canLogActivity } from "@/services/activities";
import { getEngagementTimeline, type TimelineFilters as TimelineFilterValues } from "@/services/engagementTimeline";
import { createClient } from "@/lib/supabase/server";
import { DeniedState } from "@/ui/states/DeniedState";
import { EmptyState } from "@/ui/states/EmptyState";
import { checkRouteAccess } from "../../_access";
import { LogActivityModal } from "./LogActivityModal";
import { TimelineFilters } from "./TimelineFilters";

const STAGE_TYPE_LABEL: Record<string, string> = { open: "Open", won: "Won", lost: "Lost" };

type SearchParams = { type?: string; author?: string };

export default async function DealDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { allowed } = await checkRouteAccess("/deals");
  if (!allowed) return <DeniedState message="Pipeline is not available for your role." />;

  const { id } = await params;
  const rawParams = await searchParams;
  const timelineFilters: TimelineFilterValues = {
    type: rawParams.type ? (rawParams.type as TimelineFilterValues["type"]) : undefined,
    authorId: rawParams.author || undefined,
  };
  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  const timezone = session.status === "active" ? session.timezone : "Africa/Lagos";

  // getDealDetail reads through this caller's own RLS-scoped session (migration 0005's
  // deals_select policy) - null means either the deal doesn't exist or this actor can't see it,
  // deliberately not distinguished (same reasoning as changeStage's not_found case). The
  // engagement timeline reads through the same session (activities_select/stage_events_select) -
  // if the deal itself is invisible to this actor, this comes back empty rather than erroring,
  // which the early return below makes moot anyway.
  const [deal, editView, timeline, canLog] = await Promise.all([
    getDealDetail(supabase, id),
    session.status === "active" ? getDealForEditView(supabase, session.actor, id) : null,
    getEngagementTimeline(supabase, id, timelineFilters),
    session.status === "active" ? canLogActivity(supabase, session.actor, id) : false,
  ]);

  if (!deal) {
    return <EmptyState title="Deal not found" description="It may not exist, or isn't visible to your role." />;
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 rounded-token border border-line bg-raised p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold text-ink">{deal.name}</h1>
            <span className="rounded-token bg-surface px-2 py-0.5 text-xs font-medium text-muted">{deal.reference}</span>
            <span className="rounded-token bg-accent px-2 py-0.5 text-xs font-medium text-surface">{deal.stage.name}</span>
          </div>
          <div className="flex items-center gap-2">
            {canLog ? <LogActivityModal dealId={deal.id} timezone={timezone} /> : null}
            {editView?.canEdit ? (
              <Link
                href={`/deals/${deal.id}/edit`}
                prefetch={false}
                className="rounded-token border border-line px-3 py-1.5 text-sm font-medium text-ink outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent"
              >
                Edit deal
              </Link>
            ) : null}
          </div>
        </div>
        <p className="text-sm text-muted">{deal.account.name}</p>
      </header>

      {/* Deliberately no next-action strip, last-engaged chip, most primary action buttons (Add
          Task, Advance Stage, Mark Won/Lost, Escalate, Add Contact), stakeholders or open tasks
          here - docs/06-ui-spec.md's full Deal detail spec includes all of these, but every one
          depends on an entity or action that doesn't exist yet (tasks: M4+; mark won/lost:
          M5.2-M5.3). Log Activity (M3.4) and Edit Deal (M1.7) are the two actions that now exist.
          The engagement timeline below (M3.5) supersedes M2.4's narrower stage-history-only panel,
          merging it with the activities this modal writes - see its own section comment for what
          of the full spec is still deliberately missing (attributed contacts, edit markers,
          retraction styling). Otherwise this is the same read-only skeleton docs/07-build-backlog.md
          M1.6 asked for: header, financial summary, details, account. */}

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

      {/* M3.5 (docs/07-build-backlog.md): "Engagement timeline component merging activities and
          stage events, newest first, with type and author filters and a designed empty state."
          Narrower than docs/06-ui-spec.md's full description in three ways, each because its
          dependency doesn't exist yet: no "attributed contacts" (M5.5), no "edited" marker or
          revision history (M3.6), and retracted entries aren't rendered struck-through (M3.6 - no
          code path sets retracted_at yet, so that would be speculative UI for a state nothing can
          produce). "Type icon" is a text label - no icon system exists in this codebase yet. */}
      <section className="flex flex-col gap-3 rounded-token border border-line bg-raised p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">Engagement timeline</h2>
          <TimelineFilters dealId={deal.id} values={rawParams} authors={timeline.availableAuthors} />
        </div>

        {timeline.entries.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <p className="font-medium text-ink">No engagement logged yet</p>
            <p className="text-sm text-muted">Log the first conversation.</p>
            {canLog ? (
              <div className="mt-2">
                <LogActivityModal dealId={deal.id} timezone={timezone} />
              </div>
            ) : null}
          </div>
        ) : (
          <ol className="flex flex-col gap-2">
            {timeline.entries.map((entry) =>
              entry.kind === "stage_change" ? (
                <li
                  key={`stage-${entry.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-sm first:border-t-0 first:pt-0"
                >
                  <div>
                    <p className="text-ink">
                      <span className="mr-2 rounded-token bg-raised px-1.5 py-0.5 text-xs font-medium text-muted">Stage change</span>
                      {entry.fromStageName ? `${entry.fromStageName} → ${entry.toStageName}` : entry.toStageName}
                      {entry.isRegression ? (
                        <span className="ml-2 rounded-token bg-risk px-1.5 py-0.5 text-xs text-surface">Regression</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted">
                      {entry.actorName ?? "System"} · {formatDateInTimezone(entry.occurredAt, timezone)}
                      {entry.isReconstructed ? " · reconstructed" : ""}
                    </p>
                  </div>
                  <p className="text-xs text-muted">
                    {entry.durationInPreviousSeconds === null
                      ? "—"
                      : `${formatDurationSeconds(entry.durationInPreviousSeconds)} in previous stage`}
                  </p>
                </li>
              ) : (
                <li
                  key={`activity-${entry.id}`}
                  className="flex flex-col gap-1 border-t border-line pt-2 text-sm first:border-t-0 first:pt-0"
                >
                  <p className="text-ink">
                    <span className="mr-2 rounded-token bg-accent px-1.5 py-0.5 text-xs font-medium text-surface">
                      {ACTIVITY_TYPE_LABELS[entry.type]}
                    </span>
                    {entry.summary}
                  </p>
                  <p className="text-xs text-muted">
                    {entry.authorName ?? "Unknown"} · {formatPlainDate(entry.activityDate)}
                    {entry.outcome ? ` · ${entry.outcome}` : ""}
                    {entry.outcomeDisposition ? ` (${entry.outcomeDisposition.replace("_", " ")})` : ""}
                  </p>
                </li>
              ),
            )}
          </ol>
        )}
      </section>
    </div>
  );
}
