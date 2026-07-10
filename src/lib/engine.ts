import type {
  Aggregation,
  Dataset,
  Direction,
  GroupScore,
  Kpi,
  KpiResult,
  Period,
  Rag,
  UnitScore,
} from './types';

/** Attainment is capped so a single outlier cannot distort weighted scores. */
export const ATTAINMENT_CAP = 150;

/** 1-based calendar months covered by a period. */
export function monthsInPeriod(period: Period): number[] {
  switch (period.kind) {
    case 'month':
      return [period.index];
    case 'quarter': {
      const start = (period.index - 1) * 3 + 1;
      return [start, start + 1, start + 2];
    }
    case 'half': {
      const start = (period.index - 1) * 6 + 1;
      return Array.from({ length: 6 }, (_, i) => start + i);
    }
    case 'year':
      return Array.from({ length: 12 }, (_, i) => i + 1);
  }
}

/** Roll monthly values up using the KPI's aggregation method.
 *  Nulls are treated as "not reported", never as zero. */
export function rollup(values: (number | null)[], method: Aggregation): number | null {
  const reported = values.filter((v): v is number => v !== null && !Number.isNaN(v));
  if (reported.length === 0) return null;
  switch (method) {
    case 'sum':
      return reported.reduce((a, b) => a + b, 0);
    case 'average':
      return reported.reduce((a, b) => a + b, 0) / reported.length;
    case 'end': {
      for (let i = values.length - 1; i >= 0; i--) {
        const v = values[i];
        if (v !== null && !Number.isNaN(v)) return v;
      }
      return null;
    }
  }
}

function monthlyValuesFor(
  map: Record<string, (number | null)[]>,
  kpiId: string,
  months: number[],
): (number | null)[] {
  const all = map[kpiId];
  if (!all) return months.map(() => null);
  return months.map((m) => all[m - 1] ?? null);
}

/** Target for a period: rolled up from monthly targets when they exist,
 *  otherwise derived from the annual target (prorated for sums, as-is for
 *  averages and period-end levels). */
export function periodTarget(ds: Dataset, kpi: Kpi, period: Period): number | null {
  const months = monthsInPeriod(period);
  const monthly = monthlyValuesFor(ds.monthlyTargets, kpi.id, months);
  const hasMonthly = monthly.some((v) => v !== null);
  if (hasMonthly) return rollup(monthly, kpi.aggregation);
  const annual = ds.annualTargets[kpi.id];
  if (annual === undefined || annual === null) return null;
  if (kpi.aggregation === 'sum') return (annual * months.length) / 12;
  return annual;
}

/** Actual for a period, rolled up from reported months. */
export function periodActual(ds: Dataset, kpi: Kpi, period: Period): number | null {
  const months = monthsInPeriod(period);
  const values = monthlyValuesFor(
    ds.monthlyActuals[kpi.id]
      ? { [kpi.id]: ds.monthlyActuals[kpi.id].map((e) => e.value) }
      : {},
    kpi.id,
    months,
  );
  return rollup(values, kpi.aggregation);
}

/** Attainment percentage, respecting direction. For lower-is-better KPIs,
 *  coming in under target scores above 100. Never divides by zero. */
export function attainment(
  actual: number | null,
  target: number | null,
  direction: Direction,
): number | null {
  if (actual === null || target === null) return null;
  if (direction === 'higher') {
    if (target <= 0) return null;
    return cap((actual / target) * 100);
  }
  // lower is better
  if (target <= 0) return null;
  if (actual < 0) return null;
  if (actual === 0) return ATTAINMENT_CAP;
  return cap((target / actual) * 100);
}

function cap(pct: number): number {
  const bounded = Math.min(Math.max(pct, 0), ATTAINMENT_CAP);
  return Math.round(bounded * 100) / 100;
}

/** RAG mapping: green at or above 100, amber from 80 up to 100, red below 80. */
export function ragFor(attainmentPct: number | null): Rag {
  if (attainmentPct === null) return 'none';
  if (attainmentPct >= 100) return 'green';
  if (attainmentPct >= 80) return 'amber';
  return 'red';
}

export function monthsReported(ds: Dataset, kpi: Kpi, period: Period): number {
  const entries = ds.monthlyActuals[kpi.id];
  if (!entries) return 0;
  return monthsInPeriod(period).filter((m) => entries[m - 1]?.value !== null && entries[m - 1] !== undefined)
    .length;
}

export function kpiResult(ds: Dataset, kpi: Kpi, period: Period): KpiResult {
  const target = periodTarget(ds, kpi, period);
  const actual = periodActual(ds, kpi, period);
  const att = attainment(actual, target, kpi.direction);
  return {
    kpiId: kpi.id,
    target,
    actual,
    attainment: att,
    rag: ragFor(att),
    monthsReported: monthsReported(ds, kpi, period),
  };
}

export function activeKpisForUnit(ds: Dataset, unitId: string): Kpi[] {
  return ds.kpis.filter((k) => k.unitId === unitId && k.active);
}

/** Weighted unit score across its scored KPIs. Weights renormalise over the
 *  KPIs that actually have an attainment, so unreported KPIs never silently
 *  deflate the score. */
export function unitScore(ds: Dataset, unitId: string, period: Period): UnitScore {
  const kpis = activeKpisForUnit(ds, unitId);
  const kpiResults = kpis.map((k) => kpiResult(ds, k, period));
  let weightSum = 0;
  let weighted = 0;
  kpis.forEach((k, i) => {
    const att = kpiResults[i].attainment;
    if (att === null) return;
    const w = k.weight > 0 ? k.weight : 0;
    weightSum += w;
    weighted += w * att;
  });
  const score = weightSum > 0 ? weighted / weightSum : null;
  return { unitId, score, rag: ragFor(score), kpiResults };
}

/** Weighted group score across scored units. */
export function groupScore(ds: Dataset, period: Period): GroupScore {
  const units = ds.units.filter((u) => u.active);
  const unitScores = units.map((u) => unitScore(ds, u.id, period));
  let weightSum = 0;
  let weighted = 0;
  units.forEach((u, i) => {
    const s = unitScores[i].score;
    if (s === null) return;
    const w = u.weight > 0 ? u.weight : 0;
    weightSum += w;
    weighted += w * s;
  });
  const score = weightSum > 0 ? weighted / weightSum : null;
  return { score, rag: ragFor(score), unitScores };
}

/** Counts of KPIs on track (green), at risk (amber), off track (red) across
 *  the given units (or the whole group when unitIds is omitted). */
export function statusCounts(
  ds: Dataset,
  period: Period,
  unitIds?: string[],
): { onTrack: number; atRisk: number; offTrack: number; noData: number } {
  const ids = unitIds ?? ds.units.filter((u) => u.active).map((u) => u.id);
  const counts = { onTrack: 0, atRisk: 0, offTrack: 0, noData: 0 };
  for (const unitId of ids) {
    for (const kpi of activeKpisForUnit(ds, unitId)) {
      const rag = kpiResult(ds, kpi, period).rag;
      if (rag === 'green') counts.onTrack++;
      else if (rag === 'amber') counts.atRisk++;
      else if (rag === 'red') counts.offTrack++;
      else counts.noData++;
    }
  }
  return counts;
}

/** Months still missing an actual for each continuous KPI in the period.
 *  A one-off KPI is flagged once when nothing has been reported at all. */
export function missingEntries(
  ds: Dataset,
  unitId: string,
  period: Period,
): { kpiId: string; months: number[] }[] {
  const out: { kpiId: string; months: number[] }[] = [];
  for (const kpi of activeKpisForUnit(ds, unitId)) {
    const entries = ds.monthlyActuals[kpi.id];
    const months = monthsInPeriod(period);
    if (kpi.cadence === 'one_off') {
      const any = entries?.some((e) => e.value !== null) ?? false;
      if (!any) out.push({ kpiId: kpi.id, months: [months[months.length - 1]] });
      continue;
    }
    const missing = months.filter((m) => (entries?.[m - 1]?.value ?? null) === null);
    if (missing.length > 0) out.push({ kpiId: kpi.id, months: missing });
  }
  return out;
}

/** Unit score computed month by month, for trend lines. */
export function unitTrend(
  ds: Dataset,
  unitId: string,
  throughMonth = 12,
): { month: number; score: number | null }[] {
  return Array.from({ length: throughMonth }, (_, i) => {
    const period: Period = { kind: 'month', index: i + 1 };
    return { month: i + 1, score: unitScore(ds, unitId, period).score };
  });
}

export interface Projection {
  kpiId: string;
  ytdActual: number | null;
  monthsReported: number;
  projection: number | null;
  annualTarget: number | null;
  projectedAttainment: number | null;
  rag: Rag;
}

/** Year-end projection from actuals to date. The assumption is the run rate:
 *  sums project the average reported month across 12 months, averages hold
 *  the current mean, period-end levels hold the latest value. */
export function runRateProjection(ds: Dataset, kpi: Kpi): Projection {
  const entries = ds.monthlyActuals[kpi.id] ?? [];
  const values = entries.map((e) => e.value);
  const reported = values.filter((v): v is number => v !== null);
  const year: Period = { kind: 'year', index: 1 };
  const ytdActual = rollup(values, kpi.aggregation);
  const annualTarget = periodTarget(ds, kpi, year);
  let projection: number | null = null;
  if (reported.length > 0) {
    if (kpi.aggregation === 'sum') {
      projection = (reported.reduce((a, b) => a + b, 0) / reported.length) * 12;
    } else if (kpi.aggregation === 'average') {
      projection = reported.reduce((a, b) => a + b, 0) / reported.length;
    } else {
      projection = rollup(values, 'end');
    }
  }
  const projectedAttainment = attainment(projection, annualTarget, kpi.direction);
  return {
    kpiId: kpi.id,
    ytdActual,
    monthsReported: reported.length,
    projection,
    annualTarget,
    projectedAttainment,
    rag: ragFor(projectedAttainment),
  };
}

/** Latest month (1-12) with any reported actual across the dataset, 0 if none. */
export function latestReportedMonth(ds: Dataset): number {
  let latest = 0;
  for (const entries of Object.values(ds.monthlyActuals)) {
    entries.forEach((e, i) => {
      if (e.value !== null && i + 1 > latest) latest = i + 1;
    });
  }
  return latest;
}

/** Perspective-level score for one unit, for the heatmap. */
export function unitPerspectiveScore(
  ds: Dataset,
  unitId: string,
  perspectiveId: string,
  period: Period,
): number | null {
  const kpis = activeKpisForUnit(ds, unitId).filter((k) => k.perspectiveId === perspectiveId);
  let weightSum = 0;
  let weighted = 0;
  for (const k of kpis) {
    const att = kpiResult(ds, k, period).attainment;
    if (att === null) continue;
    const w = k.weight > 0 ? k.weight : 0;
    weightSum += w;
    weighted += w * att;
  }
  return weightSum > 0 ? weighted / weightSum : null;
}
