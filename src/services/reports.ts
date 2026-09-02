import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "@/auth/permissions";
import { listActivitiesForEngagementAnalytics } from "@/data/activities";
import { listDealIdsCoOwnedByUser, listDealIdsCoOwnedByUsers } from "@/data/dealCoOwners";
import { listLossOutcomesForReport } from "@/data/dealOutcomes";
import {
  listActiveDealsForEngagementAnalytics,
  listActiveDealsForPipelineMetrics,
  listDealIdsForCohortFunnel,
  type EngagementAnalyticsDealRow,
} from "@/data/deals";
import { listAllStages, listStagesWithBottleneckThreshold } from "@/data/pipelineStages";
import { listPracticeLines } from "@/data/practiceLines";
import { listStageDurationsForDeals, listStageEventsForFunnel } from "@/data/stageEvents";
import { listDirectReports } from "@/data/users";
import { ACTIVITY_TYPES, OUTCOME_DISPOSITIONS, type ActivityType, type OutcomeDisposition } from "@/domain/activity";
import { VALUE_BAND_LABELS, valueBand, type ForecastCategory } from "@/domain/deal";
import { mean, median, withMinimumSample, type MetricResult } from "@/domain/metrics";
import { sumMoneyByCurrency, type Money } from "@/domain/money";
import { dateInTimezone, daysSincePlainDate, subtractDaysFromPlainDate } from "@/lib/dates";

export interface LossReasonBreakdown {
  label: string;
  count: number;
}

export interface LossReasonReport {
  totalLosses: number;
  byReason: LossReasonBreakdown[];
  byPractice: LossReasonBreakdown[];
  byValueBand: LossReasonBreakdown[];
  byCompetitor: LossReasonBreakdown[];
}

export type GetLossReasonReportResult = { ok: true; report: LossReasonReport } | { ok: false; code: "denied" };

const NOT_SPECIFIED_COMPETITOR = "Not specified";

function countBy<T>(items: T[], labelOf: (item: T) => string): LossReasonBreakdown[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const label = labelOf(item);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

// M5.4 (docs/07-build-backlog.md): "Loss-reason report by practice, value band and competitor."
// Scope is derived directly from role grants, the same way src/services/tasks.ts's getTeamOverview
// already does for its own multi-member breakdown - not via can() against a single Resource, since
// there is no one deal this check is about; the report spans by definition. A Team Lead/Director
// sees only their own practice(s); Executive/Tenant Admin see the tenant. A BDE has no grant of
// either kind and is denied - matching docs/02-permission-matrix.md's analytics.view_practice row
// (BDE: denied; Team Lead/Director: practice; Executive/Tenant Admin: tenant), which needed no
// changes for this milestone since it was already correctly scoped from earlier scaffolding.
//
// byValueBand deliberately lists every band, including ones with zero losses - docs/04-metric-
// definitions.md's own "no minimum-sample suppression" note for this report: a fixed, small,
// ordered taxonomy (five bands) is exactly the case where "zero in this band" is itself real,
// useful information, unlike byReason/byPractice/byCompetitor, which are open-ended sets where
// listing every possible value that never occurred would just be noise.
export async function getLossReasonReport(supabase: SupabaseClient, actor: Actor): Promise<GetLossReasonReportResult> {
  const isTenantWide = actor.roleGrants.some((grant) => grant.role === "executive" || grant.role === "tenant_admin");
  const ownPracticeLineIds = actor.roleGrants
    .filter((grant) => (grant.role === "team_lead" || grant.role === "director") && grant.practiceLineId)
    .map((grant) => grant.practiceLineId as string);

  if (!isTenantWide && ownPracticeLineIds.length === 0) {
    return { ok: false, code: "denied" };
  }

  const practiceLineIds = isTenantWide ? null : ownPracticeLineIds;
  const [rows, practiceLines] = await Promise.all([listLossOutcomesForReport(supabase, practiceLineIds), listPracticeLines(supabase)]);
  const practiceLineNameById = new Map(practiceLines.map((p) => [p.id, p.name]));

  const byReason = countBy(rows, (row) => row.reasonLabel);
  const byPractice = countBy(rows, (row) => practiceLineNameById.get(row.practiceLineId) ?? "Unknown practice");
  const byCompetitor = countBy(rows, (row) => row.competitorName ?? NOT_SPECIFIED_COMPETITOR);

  const valueBandCounts = new Map<string, number>();
  for (const label of Object.values(VALUE_BAND_LABELS)) valueBandCounts.set(label, 0);
  for (const row of rows) {
    const label = VALUE_BAND_LABELS[valueBand(row.negotiatedValueMinor ?? row.proposalValueMinor)];
    valueBandCounts.set(label, (valueBandCounts.get(label) ?? 0) + 1);
  }
  const byValueBand = Object.values(VALUE_BAND_LABELS).map((label) => ({ label, count: valueBandCounts.get(label) ?? 0 }));

  return {
    ok: true,
    report: { totalLosses: rows.length, byReason, byPractice, byValueBand, byCompetitor },
  };
}

// M6.1's own "widest scope this actor is entitled to" - own/practice/tenant, not a fixed choice per
// role. Every role holds analytics.view_own (docs/02-permission-matrix.md), unlike
// analytics.view_practice, which denies bde outright - so this never has a "denied" result the way
// getLossReasonReport does; a bde with no team_lead/director/executive/tenant_admin grant simply
// gets "own" instead of being turned away, which is the whole reason this milestone finally puts a
// real panel on /analytics for that role.
export type PipelineMetricsScope = "own" | "practice" | "tenant";

export interface CategoryForecastEntry {
  category: ForecastCategory;
  value: Money[];
}

export interface PipelineMetrics {
  scope: PipelineMetricsScope;
  dealCount: number;
  openPipelineValue: Money[];
  weightedForecast: Money[];
  categoryForecast: CategoryForecastEntry[];
}

const FORECAST_CATEGORIES: readonly ForecastCategory[] = ["pipeline", "best_case", "commit", "closed"];

// docs/04-metric-definitions.md "Pipeline metrics": Open pipeline value, Weighted forecast and
// Category forecast, all three read from the identical active/non-demo/non-deleted deal rowset
// src/data/deals.ts's listActiveDealsForPipelineMetrics already assembles - dealValue/weightedValue
// (src/domain/deal.ts) implement the doc's own formulas exactly, the same functions the Pipeline
// Deals list (M2.3/M3.7) already uses per-row; this milestone's own new work is summing them across
// a role-scoped set rather than displaying them per-deal.
//
// "Converted to the tenant reporting currency at the current FX rate" (the doc's own wording for
// both money metrics) is not implemented - no fx_rates table exists anywhere in this codebase and
// decision D-08b (which currencies, and each tenant's reporting currency) remains open, the exact
// gap M5.8's own "Won revenue" tile (D-15) already disclosed. Returns Money[] (one entry per
// currency actually present) rather than picking one currency or inventing a conversion.
//
// categoryForecast always lists all four categories, including ones with zero matching deals - the
// same "a fixed, small, ordered taxonomy where zero is itself real information" reasoning
// getLossReasonReport's own byValueBand already uses, rather than the open-ended byReason/
// byCompetitor style that omits values that never occurred.
export async function getPipelineMetrics(supabase: SupabaseClient, actor: Actor): Promise<PipelineMetrics> {
  const isTenantWide = actor.roleGrants.some((grant) => grant.role === "executive" || grant.role === "tenant_admin");
  const ownPracticeLineIds = actor.roleGrants
    .filter((grant) => (grant.role === "team_lead" || grant.role === "director") && grant.practiceLineId)
    .map((grant) => grant.practiceLineId as string);

  const scope: PipelineMetricsScope = isTenantWide ? "tenant" : ownPracticeLineIds.length > 0 ? "practice" : "own";
  const practiceLineIds = scope === "practice" ? ownPracticeLineIds : null;

  let rows = await listActiveDealsForPipelineMetrics(supabase, practiceLineIds);

  if (scope === "own") {
    const coOwnedDealIds = await listDealIdsCoOwnedByUser(supabase, actor.id);
    rows = rows.filter((row) => row.ownerId === actor.id || row.authorId === actor.id || coOwnedDealIds.has(row.id));
  }

  const openPipelineValue = sumMoneyByCurrency(rows.map((row) => row.value));
  const weightedForecast = sumMoneyByCurrency(rows.map((row) => row.weightedValue));
  const categoryForecast = FORECAST_CATEGORIES.map((category) => ({
    category,
    value: sumMoneyByCurrency(rows.filter((row) => row.forecastCategory === category).map((row) => row.value)),
  }));

  return { scope, dealCount: rows.length, openPipelineValue, weightedForecast, categoryForecast };
}

// M6.2 (docs/07-build-backlog.md): "Cohort conversion funnel; remove any current-state
// approximation." There was nothing to remove - no snapshot ratio or funnel of any kind existed
// anywhere in this codebase before this milestone; the backlog line's own phrase reads as
// precautionary, not a reference to real code. Gated on analytics.view_practice (practice for
// Team Lead/Director, tenant for Executive/Tenant Admin, denied for bde), the same shape
// getLossReasonReport already uses - a confirmed product-owner choice, not defaulted: this metric's
// own minimum sample (20 deals in the denominator) means a single bde's own book will almost always
// read "insufficient data," unlike Pipeline metrics' plain sums above, which are meaningful at any
// count. No new permission action - reuses the existing grant exactly as named in
// docs/02-permission-matrix.md.
export type CohortFunnelScope = "practice" | "tenant";

export interface FunnelBoundary {
  stageId: string;
  stageName: string;
  sortOrder: number;
  cohortSize: number;
  advancedCount: number;
  // Fraction (0..1), not a percentage - the UI's own job to format. Suppressed below the doc's own
  // "20 deals in the denominator" minimum via withMinimumSample (src/domain/metrics.ts), M6.2's own
  // first real caller of that machinery.
  conversionRate: MetricResult<number>;
}

export type GetCohortConversionFunnelResult = { ok: true; scope: CohortFunnelScope; boundaries: FunnelBoundary[] } | { ok: false; code: "denied" };

const STAGE_TO_STAGE_MINIMUM_SAMPLE = 20;

// docs/04-metric-definitions.md "Stage-to-stage conversion rate": "the denominator is the count of
// distinct deals whose earliest stage_events row entering stage N falls inside the period. The
// numerator is how many of those same deals subsequently recorded an event entering stage N+1 or
// beyond, at any later date..." Implemented literally: "N+1 or beyond" is a sort_order comparison
// (any later stage_events row whose to_stage sort_order exceeds stage N's own), not merely "the very
// next stage" - a deal that skips a stage still counts as having converted past N. No period
// filter - "All time" is the one period this codebase's analytics screens have used since M5.4/M6.1,
// and nothing in this milestone's own backlog line or docs/06-ui-spec.md's funnel mention asks for a
// picker. Only 'open'-type stages are ever a boundary's own N - a deal doesn't "convert past" a
// terminal won/lost stage, and pipeline_stages guarantees exactly one of each per tenant.
export async function getCohortConversionFunnel(supabase: SupabaseClient, actor: Actor): Promise<GetCohortConversionFunnelResult> {
  const isTenantWide = actor.roleGrants.some((grant) => grant.role === "executive" || grant.role === "tenant_admin");
  const ownPracticeLineIds = actor.roleGrants
    .filter((grant) => (grant.role === "team_lead" || grant.role === "director") && grant.practiceLineId)
    .map((grant) => grant.practiceLineId as string);

  if (!isTenantWide && ownPracticeLineIds.length === 0) {
    return { ok: false, code: "denied" };
  }

  const scope: CohortFunnelScope = isTenantWide ? "tenant" : "practice";
  const practiceLineIds = isTenantWide ? null : ownPracticeLineIds;

  const [stages, dealIds] = await Promise.all([listAllStages(supabase), listDealIdsForCohortFunnel(supabase, practiceLineIds)]);
  const openStages = stages.filter((stage) => stage.stageType === "open").sort((a, b) => a.sortOrder - b.sortOrder);
  const sortOrderByStageId = new Map(stages.map((stage) => [stage.id, stage.sortOrder]));

  const events = await listStageEventsForFunnel(supabase, dealIds);
  const eventsByDeal = new Map<string, typeof events>();
  for (const event of events) {
    const forDeal = eventsByDeal.get(event.dealId);
    if (forDeal) forDeal.push(event);
    else eventsByDeal.set(event.dealId, [event]);
  }

  const boundaries: FunnelBoundary[] = openStages.map((stage) => {
    let cohortSize = 0;
    let advancedCount = 0;

    for (const dealEvents of eventsByDeal.values()) {
      // `events` (and so every per-deal group) is already ordered by occurred_at ascending - the
      // first match is the deal's own earliest entry into this stage.
      const entryEvent = dealEvents.find((event) => event.toStageId === stage.id);
      if (!entryEvent) continue;

      cohortSize += 1;
      const entryTime = new Date(entryEvent.occurredAt).getTime();
      const advanced = dealEvents.some((event) => {
        if (new Date(event.occurredAt).getTime() <= entryTime) return false;
        return (sortOrderByStageId.get(event.toStageId) ?? -Infinity) > stage.sortOrder;
      });
      if (advanced) advancedCount += 1;
    }

    return {
      stageId: stage.id,
      stageName: stage.name,
      sortOrder: stage.sortOrder,
      cohortSize,
      advancedCount,
      conversionRate: withMinimumSample(cohortSize, STAGE_TO_STAGE_MINIMUM_SAMPLE, () => advancedCount / cohortSize),
    };
  });

  return { ok: true, scope, boundaries };
}

// M6.3 (docs/07-build-backlog.md): "Time in stage with median headline; bottleneck highlighting."
// Gated and scoped identically to getCohortConversionFunnel above (analytics.view_practice,
// own/practice/tenant collapsed to just practice/tenant - a confirmed product-owner choice, not a
// default: this metric's own minimum sample of 10 is lower than the funnel's 20, but the product
// owner chose to keep every stage-derived analytics panel consistently gated rather than let each
// one make its own independent call). Reuses CohortFunnelScope rather than a second identical type.
export interface TimeInStageDurations {
  medianSeconds: number;
  meanSeconds: number;
}

export interface TimeInStageBoundary {
  stageId: string;
  stageName: string;
  sortOrder: number;
  // null means the tenant_admin has not set one yet (src/services/pipelineStages.ts) - never
  // flagged as a bottleneck in that case, not flagged against some invented placeholder number.
  bottleneckThresholdDays: number | null;
  isBottleneck: boolean;
  durations: MetricResult<TimeInStageDurations>;
}

export type GetTimeInStageResult = { ok: true; scope: CohortFunnelScope; boundaries: TimeInStageBoundary[] } | { ok: false; code: "denied" };

const TIME_IN_STAGE_MINIMUM_SAMPLE = 10;
const SECONDS_PER_DAY = 86400;

// docs/04-metric-definitions.md "Time in stage": "For each stage_events row, duration_in_previous_
// seconds. Report median as the headline and mean as secondary... Excludes reconstructed events.
// Minimum sample: 10 completed stage transits." `listStageDurationsForDeals` already excludes
// reconstructed rows and groups by from_stage_id (the stage a deal is LEAVING, which is what
// duration_in_previous_seconds actually measures - see that function's own comment). Only 'open'
// stages are ever aggregated, the same reasoning getCohortConversionFunnel's own comment gives - a
// deal doesn't "leave" a terminal won/lost stage.
//
// "Bottleneck highlighting" (docs/07-build-backlog.md's own phrase, never defined anywhere in
// docs/04-metric-definitions.md or docs/06-ui-spec.md - the word appears exactly once in the whole
// docs set) is a confirmed product-owner decision, not an inferred formula: a stage is flagged when
// its own median (in days) exceeds that SAME stage's own tenant_admin-configured
// bottleneck_threshold_days (docs/DECISIONS.md D-17) - never a cross-stage "worst of N" comparison,
// and never flagged at all while insufficient_data or while no threshold has been set.
export async function getTimeInStage(supabase: SupabaseClient, actor: Actor): Promise<GetTimeInStageResult> {
  const isTenantWide = actor.roleGrants.some((grant) => grant.role === "executive" || grant.role === "tenant_admin");
  const ownPracticeLineIds = actor.roleGrants
    .filter((grant) => (grant.role === "team_lead" || grant.role === "director") && grant.practiceLineId)
    .map((grant) => grant.practiceLineId as string);

  if (!isTenantWide && ownPracticeLineIds.length === 0) {
    return { ok: false, code: "denied" };
  }

  const scope: CohortFunnelScope = isTenantWide ? "tenant" : "practice";
  const practiceLineIds = isTenantWide ? null : ownPracticeLineIds;

  const [stages, dealIds] = await Promise.all([
    listStagesWithBottleneckThreshold(supabase),
    listDealIdsForCohortFunnel(supabase, practiceLineIds),
  ]);
  const openStages = stages.filter((stage) => stage.stageType === "open").sort((a, b) => a.sortOrder - b.sortOrder);

  const durations = await listStageDurationsForDeals(supabase, dealIds);
  const secondsByStage = new Map<string, number[]>();
  for (const duration of durations) {
    const forStage = secondsByStage.get(duration.fromStageId);
    if (forStage) forStage.push(duration.durationInPreviousSeconds);
    else secondsByStage.set(duration.fromStageId, [duration.durationInPreviousSeconds]);
  }

  const boundaries: TimeInStageBoundary[] = openStages.map((stage) => {
    const stageSeconds = secondsByStage.get(stage.id) ?? [];
    const durationsResult = withMinimumSample(stageSeconds.length, TIME_IN_STAGE_MINIMUM_SAMPLE, () => ({
      medianSeconds: median(stageSeconds),
      meanSeconds: mean(stageSeconds),
    }));

    const isBottleneck =
      durationsResult.status === "ok" &&
      stage.bottleneckThresholdDays !== null &&
      durationsResult.value.medianSeconds / SECONDS_PER_DAY > stage.bottleneckThresholdDays;

    return {
      stageId: stage.id,
      stageName: stage.name,
      sortOrder: stage.sortOrder,
      bottleneckThresholdDays: stage.bottleneckThresholdDays,
      isBottleneck,
      durations: durationsResult,
    };
  });

  return { ok: true, scope, boundaries };
}

// M6.5 (docs/07-build-backlog.md): "Engagement analytics: coverage, volume by type paired with
// conversion, logging latency, time to first engagement, next-action coverage — all role-scoped."
// docs/04-metric-definitions.md's own "Engagement coverage" bullet is the only one of the five that
// states scoping in its own text - "own deals for a BDE, team for a Team Lead, practice for a
// Director, tenant for Executive and Tenant Admin" - the first metric in this doc requiring a real
// "team" narrower than "practice" (migration 0021, docs/DECISIONS.md D-18). The same four-way scope
// is applied consistently to all five metrics on this one panel, not just the one that states it
// explicitly - "all role-scoped" (this milestone's own backlog line) reads as one shared scoping
// story for the whole panel, not five independently-scoped metrics. Gated on analytics.view_own,
// like Pipeline metrics (M6.1) - every role holds it, so a bde is never denied, only narrowed to
// "own".
export type EngagementScope = "own" | "team" | "practice" | "tenant";

async function resolveEngagementDeals(
  supabase: SupabaseClient,
  actor: Actor,
): Promise<{ scope: EngagementScope; deals: EngagementAnalyticsDealRow[] }> {
  const isTenantWide = actor.roleGrants.some((grant) => grant.role === "executive" || grant.role === "tenant_admin");
  if (isTenantWide) {
    return { scope: "tenant", deals: await listActiveDealsForEngagementAnalytics(supabase, null) };
  }

  const hasDirectorGrant = actor.roleGrants.some((grant) => grant.role === "director" && grant.practiceLineId);
  const leaderPracticeLineIds = actor.roleGrants
    .filter((grant) => (grant.role === "team_lead" || grant.role === "director") && grant.practiceLineId)
    .map((grant) => grant.practiceLineId as string);

  // A Director's own grant dominates a Team Lead's in the rare case an actor holds both (in
  // different practice lines) - practice-wide was never ambiguous, only "team" was, so this
  // mirrors getPipelineMetrics/getCohortConversionFunnel's own existing "collect every team_lead/
  // director grant into one practice-wide set" simplification for that edge case rather than
  // inventing new mixed-grant handling this milestone doesn't need to solve.
  if (hasDirectorGrant) {
    return { scope: "practice", deals: await listActiveDealsForEngagementAnalytics(supabase, leaderPracticeLineIds) };
  }

  const teamLeadPracticeLineIds = actor.roleGrants
    .filter((grant) => grant.role === "team_lead" && grant.practiceLineId)
    .map((grant) => grant.practiceLineId as string);

  if (teamLeadPracticeLineIds.length > 0) {
    const [deals, reportsByPractice] = await Promise.all([
      listActiveDealsForEngagementAnalytics(supabase, teamLeadPracticeLineIds),
      Promise.all(teamLeadPracticeLineIds.map((id) => listDirectReports(supabase, actor.tenantId, id, actor.id))),
    ]);
    const reportIds = [...new Set(reportsByPractice.flat().map((u) => u.id))];
    const coOwnedDealIds = await listDealIdsCoOwnedByUsers(supabase, reportIds);
    const reportIdSet = new Set(reportIds);
    const teamDeals = deals.filter(
      (deal) => (deal.ownerId !== null && reportIdSet.has(deal.ownerId)) || reportIdSet.has(deal.authorId) || coOwnedDealIds.has(deal.id),
    );
    return { scope: "team", deals: teamDeals };
  }

  // own - a bde (or an actor with no working-role grant at all, which getSessionActor never
  // actually produces for an active session, but falling through to the narrowest scope is the
  // safe default regardless).
  const [deals, coOwnedDealIds] = await Promise.all([
    listActiveDealsForEngagementAnalytics(supabase, null),
    listDealIdsCoOwnedByUser(supabase, actor.id),
  ]);
  const ownDeals = deals.filter((deal) => deal.ownerId === actor.id || deal.authorId === actor.id || coOwnedDealIds.has(deal.id));
  return { scope: "own", deals: ownDeals };
}

export interface EngagementCoverage {
  activeDealCount: number;
  coveredDealCount: number;
  coverageRate: MetricResult<number>;
}

export interface ActivityTypeVolume {
  type: ActivityType;
  count: number;
  dispositionCounts: Record<OutcomeDisposition, number>;
  noDispositionCount: number;
}

export interface NextActionCoverage {
  activeDealCount: number;
  withNextActionCount: number;
  coverageRate: MetricResult<number>;
}

export interface EngagementAnalytics {
  scope: EngagementScope;
  coverage: EngagementCoverage;
  volumeByType: ActivityTypeVolume[];
  loggingLatencyDays: MetricResult<{ medianDays: number; meanDays: number }>;
  timeToFirstEngagementDays: MetricResult<{ medianDays: number }>;
  nextActionCoverage: NextActionCoverage;
}

// docs/04-metric-definitions.md's five metrics, each implemented literally against the one shared
// deal/activity rowset resolveEngagementDeals assembles above - one round trip per table, not five:
//
// - "Engagement coverage": active deals with >=1 client-facing activity in the trailing 14 days,
//   over all active deals.
// - "Activity volume by type": count of non-retracted activities grouped by type - paired with an
//   outcome-disposition breakdown per type (a confirmed product-owner choice for what "paired with
//   conversion" means here, docs/DECISIONS.md D-18 - the activities table's own outcome_disposition
//   column already exists and is populated, so this needed no new mechanism). Lists every one of
//   the 8 known activity types, including ones with zero activities - the same "small, fixed,
//   ordered taxonomy where zero is itself real information" reasoning getPipelineMetrics's own
//   categoryForecast and getLossReasonReport's own byValueBand already use, rather than the
//   open-ended byReason/byCompetitor style that omits values that never occurred. Grouped by type
//   only, not also by author - the metric's own fuller text says "type and author," but this
//   milestone's own backlog line and docs/06-ui-spec.md's panel list both say only "by type"; a
//   per-author breakdown is a real, separate addition nothing in this milestone's own scope asks
//   for.
// - "Logging latency": median (headline) and mean (secondary) of created_at's own date minus
//   activity_date, across every non-retracted activity in scope - the doc's own reasoning for
//   preferring the median over the mean here ("consulting cycle times are right-skewed and the mean
//   flatters") is the same "report both, median first" shape M6.3's own Time in stage already
//   established, so both are computed and returned rather than only the headline.
// - "Time to first engagement": days from deal creation to the EARLIEST client-facing activity, per
//   deal, then the median across every deal in scope that has had one - a deal with no client-facing
//   activity yet is excluded from this distribution entirely (it hasn't happened yet), the same
//   "excludes deals that haven't reached the thing being measured" reasoning docs/04-metric-
//   definitions.md's own "Sales cycle length" gives for excluding still-open deals.
// - "Next-action coverage": active deals with a next_action_task_id, over all active deals - already
//   almost entirely computed by the same deal rowset the other four use; M4.7's own
//   countDealsWithoutNextAction is deliberately not reused here, since it only ever computed the
//   complement count for a dashboard tile, with no scope parameter of its own and no ability to
//   return the "with" side or the total.
//
// None of the five have a minimum sample named in the doc, unlike M6.2/M6.3's real thresholds (20/
// 10) - but an empty denominator (zero active deals, or zero activities to average) is still not a
// spurious 0%/0-day figure, so each ratio/average is wrapped in withMinimumSample(count, 1, ...):
// not a meaningful statistical minimum, just the honest floor below which the arithmetic itself is
// undefined (division by zero, or median()/mean() of an empty array, which both throw rather than
// silently returning 0 - src/domain/metrics.ts's own comment already explains why).
export async function getEngagementAnalytics(supabase: SupabaseClient, actor: Actor, timezone: string, now: Date = new Date()): Promise<EngagementAnalytics> {
  const { scope, deals } = await resolveEngagementDeals(supabase, actor);
  const dealIds = deals.map((deal) => deal.id);
  const activities = await listActivitiesForEngagementAnalytics(supabase, dealIds);

  const today = dateInTimezone(now.toISOString(), timezone);
  const coverageCutoff = subtractDaysFromPlainDate(today, 14);

  const activitiesByDeal = new Map<string, typeof activities>();
  for (const activity of activities) {
    const forDeal = activitiesByDeal.get(activity.dealId);
    if (forDeal) forDeal.push(activity);
    else activitiesByDeal.set(activity.dealId, [activity]);
  }

  // Engagement coverage
  const coveredDealCount = deals.filter((deal) => {
    const dealActivities = activitiesByDeal.get(deal.id) ?? [];
    return dealActivities.some((activity) => activity.isClientFacing && activity.activityDate >= coverageCutoff);
  }).length;
  const coverage: EngagementCoverage = {
    activeDealCount: deals.length,
    coveredDealCount,
    coverageRate: withMinimumSample(deals.length, 1, () => coveredDealCount / deals.length),
  };

  // Activity volume by type, paired with outcome-disposition breakdown
  const volumeByType: ActivityTypeVolume[] = ACTIVITY_TYPES.map((type) => {
    const forType = activities.filter((activity) => activity.type === type);
    const dispositionCounts = Object.fromEntries(OUTCOME_DISPOSITIONS.map((d) => [d, 0])) as Record<OutcomeDisposition, number>;
    let noDispositionCount = 0;
    for (const activity of forType) {
      if (activity.outcomeDisposition) dispositionCounts[activity.outcomeDisposition] += 1;
      else noDispositionCount += 1;
    }
    return { type, count: forType.length, dispositionCounts, noDispositionCount };
  });

  // Logging latency: created_at's own date minus activity_date, across every activity in scope
  const latencyDays = activities.map((activity) => daysSincePlainDate(activity.activityDate, dateInTimezone(activity.createdAt, timezone)));
  const loggingLatencyDays = withMinimumSample(latencyDays.length, 1, () => ({
    medianDays: median(latencyDays),
    meanDays: mean(latencyDays),
  }));

  // Time to first engagement: per deal, days from creation to the earliest client-facing activity -
  // only deals that have had one contribute to the distribution.
  const firstEngagementDays: number[] = [];
  for (const deal of deals) {
    const dealActivities = (activitiesByDeal.get(deal.id) ?? []).filter((activity) => activity.isClientFacing);
    if (dealActivities.length === 0) continue;
    const earliestActivityDate = dealActivities.reduce(
      (earliest, activity) => (activity.activityDate < earliest ? activity.activityDate : earliest),
      dealActivities[0]!.activityDate,
    );
    firstEngagementDays.push(daysSincePlainDate(earliestActivityDate, dateInTimezone(deal.createdAt, timezone)));
  }
  const timeToFirstEngagementDays = withMinimumSample(firstEngagementDays.length, 1, () => ({ medianDays: median(firstEngagementDays) }));

  // Next-action coverage
  const withNextActionCount = deals.filter((deal) => deal.nextActionTaskId !== null).length;
  const nextActionCoverage: NextActionCoverage = {
    activeDealCount: deals.length,
    withNextActionCount,
    coverageRate: withMinimumSample(deals.length, 1, () => withNextActionCount / deals.length),
  };

  return { scope, coverage, volumeByType, loggingLatencyDays, timeToFirstEngagementDays, nextActionCoverage };
}
