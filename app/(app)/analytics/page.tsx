import { ACTIVITY_TYPE_LABELS, OUTCOME_DISPOSITIONS, OUTCOME_DISPOSITION_LABELS } from "@/domain/activity";
import { formatMoney, type Money } from "@/domain/money";
import { formatDurationSeconds } from "@/lib/dates";
import { getSessionActor } from "@/services/actor";
import {
  getCohortConversionFunnel,
  getEngagementAnalytics,
  getLossReasonReport,
  getPipelineMetrics,
  getTimeInStage,
  type CategoryForecastEntry,
  type CohortFunnelScope,
  type EngagementAnalytics,
  type EngagementScope,
  type FunnelBoundary,
  type LossReasonBreakdown,
  type PipelineMetricsScope,
  type TimeInStageBoundary,
} from "@/services/reports";
import { createClient } from "@/lib/supabase/server";
import { DeniedState } from "@/ui/states/DeniedState";
import { EmptyState } from "@/ui/states/EmptyState";
import { checkRouteAccess } from "../_access";

const SCOPE_LABEL: Record<PipelineMetricsScope, string> = {
  own: "Your pipeline",
  practice: "Practice pipeline",
  tenant: "Tenant-wide pipeline",
};

const FUNNEL_SCOPE_LABEL: Record<CohortFunnelScope, string> = {
  practice: "Practice conversion funnel",
  tenant: "Tenant-wide conversion funnel",
};

const TIME_IN_STAGE_SCOPE_LABEL: Record<CohortFunnelScope, string> = {
  practice: "Practice time in stage",
  tenant: "Tenant-wide time in stage",
};

const ENGAGEMENT_SCOPE_LABEL: Record<EngagementScope, string> = {
  own: "Your engagement",
  team: "Team engagement",
  practice: "Practice engagement",
  tenant: "Tenant-wide engagement",
};

function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(0)}%`;
}

function formatDays(days: number): string {
  return `${days.toFixed(0)} ${days === 1 ? "day" : "days"}`;
}

function MoneyList({ values }: { values: Money[] }) {
  if (values.length === 0) return <span className="text-ink">—</span>;
  return (
    <>
      {values.map((money) => (
        <span key={money.currency} className="block text-ink">
          {formatMoney(money)}
        </span>
      ))}
    </>
  );
}

// M6.1 (docs/07-build-backlog.md): "Metric layer implementing 04-metric-definitions.md exactly."
// docs/04-metric-definitions.md's "Pipeline metrics" section - the one section not already claimed
// by name in M6.2-M6.9's own backlog lines. The first panel on this screen every role (including
// bde) can see, since analytics.view_own is "yes" across the board - unlike the Loss reasons panel
// below, which denies bde entirely.
function PipelineMetricsPanel({
  scope,
  dealCount,
  openPipelineValue,
  weightedForecast,
  categoryForecast,
}: {
  scope: PipelineMetricsScope;
  dealCount: number;
  openPipelineValue: Money[];
  weightedForecast: Money[];
  categoryForecast: CategoryForecastEntry[];
}) {
  return (
    <section className="flex flex-col gap-4 rounded-token border border-line bg-raised p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-ink">{SCOPE_LABEL[scope]}</h1>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-muted">Period</dt>
          <dd className="text-ink">All time</dd>
          <dt className="text-muted">Comparison basis</dt>
          <dd className="text-ink">None — single snapshot</dd>
          <dt className="text-muted">Sample size</dt>
          <dd className="text-ink">{dealCount} active deals</dd>
          <dt className="text-muted">Exclusions</dt>
          <dd className="text-ink">Soft-deleted and demo deals, and deals not in active status (won, lost, on hold)</dd>
        </dl>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1 rounded-token bg-surface p-4">
          <p className="text-xs font-medium text-muted">Open pipeline value</p>
          <MoneyList values={openPipelineValue} />
        </div>
        <div className="flex flex-col gap-1 rounded-token bg-surface p-4">
          <p className="text-xs font-medium text-muted">Weighted forecast</p>
          <MoneyList values={weightedForecast} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-ink">Category forecast</h2>
        <table className="w-full text-sm">
          <tbody>
            {categoryForecast.map((entry) => (
              <tr key={entry.category} className="border-t border-line first:border-t-0">
                <td className="py-1.5 pr-4 capitalize text-ink">{entry.category.replace("_", " ")}</td>
                <td className="py-1.5 text-right">
                  <MoneyList values={entry.value} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// M6.2 (docs/07-build-backlog.md): "Cohort conversion funnel; remove any current-state
// approximation." Gated on getCohortConversionFunnel's own denied result (analytics.view_practice -
// a confirmed product-owner choice, not the everyone-can-see shape Pipeline metrics above uses),
// the identical "reached this page, but this one panel is absent" treatment the Loss reasons panel
// below already established - never a hidden nav link as the only control (CLAUDE.md #1).
function CohortFunnelPanel({ scope, boundaries }: { scope: CohortFunnelScope; boundaries: FunnelBoundary[] }) {
  const totalCohort = boundaries.reduce((sum, boundary) => sum + boundary.cohortSize, 0);

  return (
    <section className="flex flex-col gap-3 rounded-token border border-line bg-raised p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-ink">{FUNNEL_SCOPE_LABEL[scope]}</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-muted">Period</dt>
          <dd className="text-ink">All time</dd>
          <dt className="text-muted">Comparison basis</dt>
          <dd className="text-ink">None — single snapshot</dd>
          <dt className="text-muted">Sample size</dt>
          <dd className="text-ink">{totalCohort} deals across every open stage&apos;s own cohort</dd>
          <dt className="text-muted">Exclusions</dt>
          <dd className="text-ink">Soft-deleted deals, demo deals, and reconstructed stage events</dd>
        </dl>
      </div>

      {boundaries.length === 0 ? (
        <p className="text-sm text-muted">No open stages are configured yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-medium text-muted">
              <th className="pb-1.5 pr-4 font-medium">Stage</th>
              <th className="pb-1.5 pr-4 text-right font-medium">Cohort</th>
              <th className="pb-1.5 pr-4 text-right font-medium">Advanced</th>
              <th className="pb-1.5 text-right font-medium">Conversion rate</th>
            </tr>
          </thead>
          <tbody>
            {boundaries.map((boundary) => (
              <tr key={boundary.stageId} className="border-t border-line">
                <td className="py-1.5 pr-4 text-ink">{boundary.stageName}</td>
                <td className="py-1.5 pr-4 text-right text-ink">{boundary.cohortSize}</td>
                <td className="py-1.5 pr-4 text-right text-ink">{boundary.advancedCount}</td>
                <td className="py-1.5 text-right text-ink">
                  {boundary.conversionRate.status === "ok" ? (
                    `${(boundary.conversionRate.value * 100).toFixed(0)}%`
                  ) : (
                    <span className="text-muted">
                      Insufficient data ({boundary.conversionRate.sampleSize}, need {boundary.conversionRate.minimumRequired})
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// M6.3 (docs/07-build-backlog.md): "Time in stage with median headline; bottleneck highlighting."
// Gated identically to the Cohort funnel panel above (analytics.view_practice). "Bottleneck"
// (a badge, not a row colour - this table already carries a numeric column, and a badge reads
// unambiguously next to it) means this stage's own median exceeds this SAME stage's own
// tenant_admin-configured threshold (/admin/pipeline-stages, D-17) - never a comparison across
// stages, and never shown while insufficient_data or while no threshold has been set for that
// stage.
function TimeInStagePanel({ scope, boundaries }: { scope: CohortFunnelScope; boundaries: TimeInStageBoundary[] }) {
  const totalTransits = boundaries.reduce((sum, boundary) => sum + (boundary.durations.status === "ok" ? boundary.durations.sampleSize : 0), 0);

  return (
    <section className="flex flex-col gap-3 rounded-token border border-line bg-raised p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-ink">{TIME_IN_STAGE_SCOPE_LABEL[scope]}</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-muted">Period</dt>
          <dd className="text-ink">All time</dd>
          <dt className="text-muted">Comparison basis</dt>
          <dd className="text-ink">None — single snapshot</dd>
          <dt className="text-muted">Sample size</dt>
          <dd className="text-ink">{totalTransits} completed stage transits</dd>
          <dt className="text-muted">Exclusions</dt>
          <dd className="text-ink">Soft-deleted deals, demo deals, and reconstructed stage events</dd>
        </dl>
      </div>

      {boundaries.length === 0 ? (
        <p className="text-sm text-muted">No open stages are configured yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-medium text-muted">
              <th className="pb-1.5 pr-4 font-medium">Stage</th>
              <th className="pb-1.5 pr-4 text-right font-medium">Median (headline)</th>
              <th className="pb-1.5 pr-4 text-right font-medium">Mean</th>
              <th className="pb-1.5 text-right font-medium">Sample</th>
            </tr>
          </thead>
          <tbody>
            {boundaries.map((boundary) => (
              <tr key={boundary.stageId} className="border-t border-line">
                <td className="py-1.5 pr-4 text-ink">
                  {boundary.stageName}
                  {boundary.isBottleneck ? (
                    <span className="ml-2 rounded-token bg-lost px-1.5 py-0.5 text-xs font-medium text-surface">Bottleneck</span>
                  ) : null}
                </td>
                {boundary.durations.status === "ok" ? (
                  <>
                    <td className="py-1.5 pr-4 text-right font-medium text-ink">{formatDurationSeconds(boundary.durations.value.medianSeconds)}</td>
                    <td className="py-1.5 pr-4 text-right text-ink">{formatDurationSeconds(boundary.durations.value.meanSeconds)}</td>
                    <td className="py-1.5 text-right text-ink">{boundary.durations.sampleSize}</td>
                  </>
                ) : (
                  <td className="py-1.5 text-right text-muted" colSpan={3}>
                    Insufficient data ({boundary.durations.sampleSize}, need {boundary.durations.minimumRequired})
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// M6.5 (docs/07-build-backlog.md): "Engagement analytics: coverage, volume by type paired with
// conversion, logging latency, time to first engagement, next-action coverage — all role-scoped."
// Gated on analytics.view_own like Pipeline metrics above (M6.1) - a bde is never denied this panel,
// only narrowed to "own" scope, unlike the Cohort funnel/Time in stage panels which deny a bde
// outright.
function EngagementAnalyticsPanel({
  scope,
  coverage,
  volumeByType,
  loggingLatencyDays,
  timeToFirstEngagementDays,
  nextActionCoverage,
}: {
  scope: EngagementScope;
  coverage: EngagementAnalytics["coverage"];
  volumeByType: EngagementAnalytics["volumeByType"];
  loggingLatencyDays: EngagementAnalytics["loggingLatencyDays"];
  timeToFirstEngagementDays: EngagementAnalytics["timeToFirstEngagementDays"];
  nextActionCoverage: EngagementAnalytics["nextActionCoverage"];
}) {
  return (
    <section className="flex flex-col gap-4 rounded-token border border-line bg-raised p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-ink">{ENGAGEMENT_SCOPE_LABEL[scope]}</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-muted">Period</dt>
          <dd className="text-ink">All time (coverage: trailing 14 days)</dd>
          <dt className="text-muted">Comparison basis</dt>
          <dd className="text-ink">None — single snapshot</dd>
          <dt className="text-muted">Sample size</dt>
          <dd className="text-ink">{coverage.activeDealCount} active deals</dd>
          <dt className="text-muted">Exclusions</dt>
          <dd className="text-ink">Soft-deleted deals, demo deals, and retracted activities</dd>
        </dl>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1 rounded-token bg-surface p-4">
          <p className="text-xs font-medium text-muted">Engagement coverage</p>
          {coverage.coverageRate.status === "ok" ? (
            <p className="text-lg font-semibold text-ink">
              {formatPercent(coverage.coverageRate.value)}{" "}
              <span className="text-xs font-normal text-muted">
                ({coverage.coveredDealCount} of {coverage.activeDealCount})
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted">No active deals</p>
          )}
        </div>
        <div className="flex flex-col gap-1 rounded-token bg-surface p-4">
          <p className="text-xs font-medium text-muted">Next-action coverage</p>
          {nextActionCoverage.coverageRate.status === "ok" ? (
            <p className="text-lg font-semibold text-ink">
              {formatPercent(nextActionCoverage.coverageRate.value)}{" "}
              <span className="text-xs font-normal text-muted">
                ({nextActionCoverage.withNextActionCount} of {nextActionCoverage.activeDealCount})
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted">No active deals</p>
          )}
        </div>
        <div className="flex flex-col gap-1 rounded-token bg-surface p-4">
          <p className="text-xs font-medium text-muted">Logging latency</p>
          {loggingLatencyDays.status === "ok" ? (
            <p className="text-lg font-semibold text-ink">
              {formatDays(loggingLatencyDays.value.medianDays)}{" "}
              <span className="text-xs font-normal text-muted">(mean {formatDays(loggingLatencyDays.value.meanDays)})</span>
            </p>
          ) : (
            <p className="text-sm text-muted">No activities logged</p>
          )}
        </div>
        <div className="flex flex-col gap-1 rounded-token bg-surface p-4">
          <p className="text-xs font-medium text-muted">Time to first engagement</p>
          {timeToFirstEngagementDays.status === "ok" ? (
            <p className="text-lg font-semibold text-ink">{formatDays(timeToFirstEngagementDays.value.medianDays)}</p>
          ) : (
            <p className="text-sm text-muted">No deals engaged yet</p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-ink">Activity volume by type</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium text-muted">
                <th className="pb-1.5 pr-4 font-medium">Type</th>
                <th className="pb-1.5 pr-4 text-right font-medium">Count</th>
                {OUTCOME_DISPOSITIONS.map((disposition) => (
                  <th key={disposition} className="pb-1.5 pr-4 text-right font-medium">
                    {OUTCOME_DISPOSITION_LABELS[disposition]}
                  </th>
                ))}
                <th className="pb-1.5 text-right font-medium">Not recorded</th>
              </tr>
            </thead>
            <tbody>
              {volumeByType.map((row) => (
                <tr key={row.type} className="border-t border-line">
                  <td className="py-1.5 pr-4 text-ink">{ACTIVITY_TYPE_LABELS[row.type]}</td>
                  <td className="py-1.5 pr-4 text-right text-ink">{row.count}</td>
                  {OUTCOME_DISPOSITIONS.map((disposition) => (
                    <td key={disposition} className="py-1.5 pr-4 text-right text-ink">
                      {row.dispositionCounts[disposition]}
                    </td>
                  ))}
                  <td className="py-1.5 text-right text-ink">{row.noDispositionCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// M5.4 (docs/07-build-backlog.md): "Loss-reason report by practice, value band and competitor."
// checkRouteAccess lets every role onto /analytics at all (src/domain/navigation.ts's NAV_BY_ROLE
// names it for everyone), but that is only the coarse "can this role type this URL" gate
// (CLAUDE.md #1); getLossReasonReport's own denied result is the precise one - a bde reaches this
// page but never sees this particular panel, matching analytics.view_practice's own denial for
// that role. Unlike M6.1's Pipeline metrics panel above it, this is no longer the page's only
// content, so a bde being denied this one panel no longer means a bde sees nothing at all here.
//
// docs/06-ui-spec.md's cross-cutting Analytics rule ("every panel carries: period label, comparison
// basis, sample size, and a footnote on exclusions") is honoured literally: period is "All time"
// (M5.4's own backlog line names no period filter, unlike M4.7's very explicit "no next step" filter
// spec - adding one nobody asked for would be scope creep this session's own conventions elsewhere
// avoid), comparison basis is stated as none (a single snapshot, not a period-over-period figure),
// sample size is the total loss count, and the exclusions footnote names soft-deleted and demo rows
// plainly rather than leaving them unstated.
function Breakdown({ title, rows }: { title: string; rows: LossReasonBreakdown[] }) {
  return (
    <section className="flex flex-col gap-3 rounded-token border border-line bg-raised p-6">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No losses recorded.</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-line first:border-t-0">
                <td className="py-1.5 pr-4 text-ink">{row.label}</td>
                <td className="py-1.5 text-right font-medium text-ink">{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default async function AnalyticsPage() {
  const { allowed } = await checkRouteAccess("/analytics");
  if (!allowed) return <DeniedState message="Analytics is not available for your role." />;

  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  if (session.status !== "active") return <DeniedState message="Analytics is not available for your role." />;

  const [pipelineMetrics, funnelResult, timeInStageResult, engagementAnalytics, lossReasonResult] = await Promise.all([
    getPipelineMetrics(supabase, session.actor),
    getCohortConversionFunnel(supabase, session.actor),
    getTimeInStage(supabase, session.actor),
    getEngagementAnalytics(supabase, session.actor, session.timezone),
    getLossReasonReport(supabase, session.actor),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PipelineMetricsPanel
        scope={pipelineMetrics.scope}
        dealCount={pipelineMetrics.dealCount}
        openPipelineValue={pipelineMetrics.openPipelineValue}
        weightedForecast={pipelineMetrics.weightedForecast}
        categoryForecast={pipelineMetrics.categoryForecast}
      />

      {funnelResult.ok ? <CohortFunnelPanel scope={funnelResult.scope} boundaries={funnelResult.boundaries} /> : null}

      {timeInStageResult.ok ? <TimeInStagePanel scope={timeInStageResult.scope} boundaries={timeInStageResult.boundaries} /> : null}

      <EngagementAnalyticsPanel
        scope={engagementAnalytics.scope}
        coverage={engagementAnalytics.coverage}
        volumeByType={engagementAnalytics.volumeByType}
        loggingLatencyDays={engagementAnalytics.loggingLatencyDays}
        timeToFirstEngagementDays={engagementAnalytics.timeToFirstEngagementDays}
        nextActionCoverage={engagementAnalytics.nextActionCoverage}
      />

      {lossReasonResult.ok ? (
        lossReasonResult.report.totalLosses === 0 ? (
          <EmptyState
            title="No losses recorded yet"
            description="Once a deal is marked lost, this report breaks it down by reason, practice, value band and competitor."
          />
        ) : (
          <div className="flex flex-col gap-6">
            <header className="flex flex-col gap-1 rounded-token border border-line bg-raised p-6">
              <h2 className="text-lg font-semibold text-ink">Loss reasons</h2>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                <dt className="text-muted">Period</dt>
                <dd className="text-ink">All time</dd>
                <dt className="text-muted">Comparison basis</dt>
                <dd className="text-ink">None — single snapshot</dd>
                <dt className="text-muted">Sample size</dt>
                <dd className="text-ink">{lossReasonResult.report.totalLosses} losses</dd>
                <dt className="text-muted">Exclusions</dt>
                <dd className="text-ink">Soft-deleted and demo deals</dd>
              </dl>
            </header>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <Breakdown title="By reason" rows={lossReasonResult.report.byReason} />
              <Breakdown title="By practice" rows={lossReasonResult.report.byPractice} />
              <Breakdown title="By value band" rows={lossReasonResult.report.byValueBand} />
              <Breakdown title="By competitor" rows={lossReasonResult.report.byCompetitor} />
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}
