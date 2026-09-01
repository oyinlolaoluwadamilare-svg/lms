import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "@/auth/permissions";
import { listDealIdsCoOwnedByUser } from "@/data/dealCoOwners";
import { listLossOutcomesForReport } from "@/data/dealOutcomes";
import { listActiveDealsForPipelineMetrics, listDealIdsForCohortFunnel } from "@/data/deals";
import { listAllStages } from "@/data/pipelineStages";
import { listPracticeLines } from "@/data/practiceLines";
import { listStageEventsForFunnel } from "@/data/stageEvents";
import { VALUE_BAND_LABELS, valueBand, type ForecastCategory } from "@/domain/deal";
import { withMinimumSample, type MetricResult } from "@/domain/metrics";
import { sumMoneyByCurrency, type Money } from "@/domain/money";

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
