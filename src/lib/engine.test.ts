import { describe, expect, it } from 'vitest';
import {
  ATTAINMENT_CAP,
  attainment,
  groupScore,
  kpiResult,
  latestReportedMonth,
  missingEntries,
  monthsInPeriod,
  periodActual,
  periodTarget,
  ragFor,
  rollup,
  runRateProjection,
  statusCounts,
  unitPerspectiveScore,
  unitScore,
} from './engine';
import type { Dataset, Kpi, Period } from './types';

function makeKpi(overrides: Partial<Kpi> = {}): Kpi {
  return {
    id: 'k1',
    unitId: 'u1',
    objectiveId: 'o1',
    perspectiveId: 'p1',
    name: 'Advisory Revenue',
    uom: 'NGN m',
    direction: 'higher',
    weight: 1,
    cadence: 'continuous',
    aggregation: 'sum',
    sortOrder: 0,
    active: true,
    ...overrides,
  };
}

function months(values: (number | null)[]): (number | null)[] {
  const arr: (number | null)[] = Array(12).fill(null);
  values.forEach((v, i) => (arr[i] = v));
  return arr;
}

function entries(values: (number | null)[]) {
  return months(values).map((v) => ({ value: v, note: null }));
}

function makeDataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    year: 2026,
    units: [
      { id: 'u1', name: 'Consulting', slug: 'consulting', type: 'LOB', weight: 2, logoKey: null, sortOrder: 0, active: true },
      { id: 'u2', name: 'Outsourcing', slug: 'outsourcing', type: 'LOB', weight: 1, logoKey: null, sortOrder: 1, active: true },
    ],
    perspectives: [
      { id: 'p1', name: 'Financial', sortOrder: 0 },
      { id: 'p2', name: 'People and Capability', sortOrder: 1 },
    ],
    objectives: [],
    keyResults: [],
    aspirations: [],
    kpis: [],
    annualTargets: {},
    monthlyTargets: {},
    monthlyActuals: {},
    initiatives: [],
    submissions: [],
    ...overrides,
  };
}

const Q1: Period = { kind: 'quarter', index: 1 };
const H1: Period = { kind: 'half', index: 1 };
const YEAR: Period = { kind: 'year', index: 1 };

describe('monthsInPeriod', () => {
  it('maps each period kind to its calendar months', () => {
    expect(monthsInPeriod({ kind: 'month', index: 6 })).toEqual([6]);
    expect(monthsInPeriod({ kind: 'quarter', index: 2 })).toEqual([4, 5, 6]);
    expect(monthsInPeriod({ kind: 'half', index: 2 })).toEqual([7, 8, 9, 10, 11, 12]);
    expect(monthsInPeriod(YEAR)).toHaveLength(12);
  });
});

describe('rollup', () => {
  it('sums flow measures', () => {
    expect(rollup([100, 120, 80], 'sum')).toBe(300);
  });
  it('averages rate measures so a 90% rate stays near 90%, never 270%', () => {
    expect(rollup([90, 92, 88], 'average')).toBe(90);
  });
  it('takes the closing value for period-end measures', () => {
    expect(rollup([500, 520, 540], 'end')).toBe(540);
  });
  it('treats nulls as not reported, not zero', () => {
    expect(rollup([100, null, 80], 'sum')).toBe(180);
    expect(rollup([90, null, 88], 'average')).toBe(89);
    expect(rollup([500, 540, null], 'end')).toBe(540);
  });
  it('returns null when nothing is reported', () => {
    expect(rollup([null, null], 'sum')).toBeNull();
    expect(rollup([], 'average')).toBeNull();
  });
});

describe('attainment and RAG', () => {
  it('scores higher-is-better as actual over target', () => {
    expect(attainment(110, 100, 'higher')).toBe(110);
    expect(attainment(80, 100, 'higher')).toBe(80);
  });
  it('inverts for lower-is-better: under target is good', () => {
    expect(attainment(8, 10, 'lower')).toBe(125);
    expect(attainment(12.5, 10, 'lower')).toBe(80);
  });
  it('caps outliers at the attainment cap', () => {
    expect(attainment(1000, 100, 'higher')).toBe(ATTAINMENT_CAP);
    expect(attainment(1, 100, 'lower')).toBe(ATTAINMENT_CAP);
  });
  it('scores a lower-is-better actual of zero as the cap, not infinity', () => {
    expect(attainment(0, 5, 'lower')).toBe(ATTAINMENT_CAP);
  });
  it('never divides by zero', () => {
    expect(attainment(50, 0, 'higher')).toBeNull();
    expect(attainment(0, 0, 'lower')).toBeNull();
    expect(attainment(null, 100, 'higher')).toBeNull();
    expect(attainment(100, null, 'higher')).toBeNull();
  });
  it('maps RAG at the exact boundaries', () => {
    expect(ragFor(100)).toBe('green');
    expect(ragFor(99.9)).toBe('amber');
    expect(ragFor(80)).toBe('amber');
    expect(ragFor(79.9)).toBe('red');
    expect(ragFor(null)).toBe('none');
  });
});

describe('periodTarget', () => {
  it('rolls up monthly targets when they exist', () => {
    const kpi = makeKpi();
    const ds = makeDataset({
      kpis: [kpi],
      monthlyTargets: { k1: months([100, 110, 120]) },
    });
    expect(periodTarget(ds, kpi, Q1)).toBe(330);
  });
  it('prorates an annual target for sums when no monthly phasing exists', () => {
    const kpi = makeKpi();
    const ds = makeDataset({ kpis: [kpi], annualTargets: { k1: 1200 } });
    expect(periodTarget(ds, kpi, Q1)).toBe(300);
    expect(periodTarget(ds, kpi, YEAR)).toBe(1200);
  });
  it('uses the annual target as-is for averages and period-end levels', () => {
    const rate = makeKpi({ id: 'k2', aggregation: 'average' });
    const stock = makeKpi({ id: 'k3', aggregation: 'end' });
    const ds = makeDataset({
      kpis: [rate, stock],
      annualTargets: { k2: 90, k3: 500 },
    });
    expect(periodTarget(ds, rate, Q1)).toBe(90);
    expect(periodTarget(ds, stock, H1)).toBe(500);
  });
  it('returns null with no targets at all', () => {
    const kpi = makeKpi();
    expect(periodTarget(makeDataset({ kpis: [kpi] }), kpi, Q1)).toBeNull();
  });
});

describe('periodActual and kpiResult', () => {
  it('rolls actuals by the KPI aggregation and reports RAG', () => {
    const kpi = makeKpi();
    const ds = makeDataset({
      kpis: [kpi],
      monthlyTargets: { k1: months([100, 100, 100]) },
      monthlyActuals: { k1: entries([90, 100, 110]) },
    });
    expect(periodActual(ds, kpi, Q1)).toBe(300);
    const r = kpiResult(ds, kpi, Q1);
    expect(r.attainment).toBe(100);
    expect(r.rag).toBe('green');
    expect(r.monthsReported).toBe(3);
  });
  it('marks a KPI with no data as unscored, not zero', () => {
    const kpi = makeKpi();
    const ds = makeDataset({ kpis: [kpi], annualTargets: { k1: 1200 } });
    const r = kpiResult(ds, kpi, Q1);
    expect(r.actual).toBeNull();
    expect(r.attainment).toBeNull();
    expect(r.rag).toBe('none');
  });
});

describe('unitScore', () => {
  it('weights KPI attainments', () => {
    const heavy = makeKpi({ id: 'k1', weight: 3 });
    const light = makeKpi({ id: 'k2', weight: 1 });
    const ds = makeDataset({
      kpis: [heavy, light],
      monthlyTargets: { k1: months([100]), k2: months([100]) },
      monthlyActuals: { k1: entries([120]), k2: entries([80]) },
    });
    const s = unitScore(ds, 'u1', { kind: 'month', index: 1 });
    // (3*120 + 1*80) / 4 = 110
    expect(s.score).toBe(110);
    expect(s.rag).toBe('green');
  });
  it('renormalises weights over scored KPIs so missing data does not deflate the score', () => {
    const reported = makeKpi({ id: 'k1', weight: 1 });
    const unreported = makeKpi({ id: 'k2', weight: 9 });
    const ds = makeDataset({
      kpis: [reported, unreported],
      monthlyTargets: { k1: months([100]), k2: months([100]) },
      monthlyActuals: { k1: entries([90]) },
    });
    const s = unitScore(ds, 'u1', { kind: 'month', index: 1 });
    expect(s.score).toBe(90);
  });
  it('excludes inactive KPIs and returns null with no scored KPIs', () => {
    const inactive = makeKpi({ id: 'k1', active: false });
    const ds = makeDataset({ kpis: [inactive] });
    const s = unitScore(ds, 'u1', Q1);
    expect(s.score).toBeNull();
    expect(s.rag).toBe('none');
  });
});

describe('groupScore', () => {
  it('weights unit scores into the group score', () => {
    const k1 = makeKpi({ id: 'k1', unitId: 'u1' });
    const k2 = makeKpi({ id: 'k2', unitId: 'u2' });
    const ds = makeDataset({
      kpis: [k1, k2],
      monthlyTargets: { k1: months([100]), k2: months([100]) },
      monthlyActuals: { k1: entries([120]), k2: entries([60]) },
    });
    const g = groupScore(ds, { kind: 'month', index: 1 });
    // u1 weight 2 score 120, u2 weight 1 score 60 -> (240+60)/3 = 100
    expect(g.score).toBe(100);
    expect(g.rag).toBe('green');
    expect(g.unitScores).toHaveLength(2);
  });
  it('skips units with no data', () => {
    const k1 = makeKpi({ id: 'k1', unitId: 'u1' });
    const ds = makeDataset({
      kpis: [k1],
      monthlyTargets: { k1: months([100]) },
      monthlyActuals: { k1: entries([90]) },
    });
    const g = groupScore(ds, { kind: 'month', index: 1 });
    expect(g.score).toBe(90);
  });
});

describe('one-off KPIs', () => {
  it('scores a one-off deliverable on achievement by period end', () => {
    const oneOff = makeKpi({
      id: 'k1',
      cadence: 'one_off',
      aggregation: 'end',
      uom: 'count',
    });
    const ds = makeDataset({
      kpis: [oneOff],
      annualTargets: { k1: 1 },
      monthlyActuals: { k1: entries([null, null, null, 1]) },
    });
    const r = kpiResult(ds, oneOff, H1);
    expect(r.actual).toBe(1);
    expect(r.attainment).toBe(100);
    expect(r.rag).toBe('green');
  });
});

describe('statusCounts and missingEntries', () => {
  it('counts KPI RAG buckets across the group', () => {
    const green = makeKpi({ id: 'k1' });
    const red = makeKpi({ id: 'k2' });
    const none = makeKpi({ id: 'k3' });
    const ds = makeDataset({
      kpis: [green, red, none],
      monthlyTargets: { k1: months([100]), k2: months([100]), k3: months([100]) },
      monthlyActuals: { k1: entries([100]), k2: entries([50]) },
    });
    const c = statusCounts(ds, { kind: 'month', index: 1 });
    expect(c).toEqual({ onTrack: 1, atRisk: 0, offTrack: 1, noData: 1 });
  });
  it('lists missing months for continuous KPIs and unreported one-offs once', () => {
    const cont = makeKpi({ id: 'k1' });
    const oneOff = makeKpi({ id: 'k2', cadence: 'one_off', aggregation: 'end' });
    const ds = makeDataset({
      kpis: [cont, oneOff],
      monthlyActuals: { k1: entries([100, null, null]) },
    });
    const missing = missingEntries(ds, 'u1', Q1);
    expect(missing).toEqual([
      { kpiId: 'k1', months: [2, 3] },
      { kpiId: 'k2', months: [3] },
    ]);
  });
});

describe('runRateProjection', () => {
  it('projects sums from the average reported month', () => {
    const kpi = makeKpi();
    const ds = makeDataset({
      kpis: [kpi],
      annualTargets: { k1: 1200 },
      monthlyActuals: { k1: entries([100, 110, 90]) },
    });
    const p = runRateProjection(ds, kpi);
    expect(p.ytdActual).toBe(300);
    expect(p.projection).toBe(1200);
    expect(p.projectedAttainment).toBe(100);
  });
  it('holds the mean for averages and the latest level for period-end', () => {
    const rate = makeKpi({ id: 'k2', aggregation: 'average' });
    const stock = makeKpi({ id: 'k3', aggregation: 'end' });
    const ds = makeDataset({
      kpis: [rate, stock],
      annualTargets: { k2: 90, k3: 600 },
      monthlyActuals: {
        k2: entries([88, 92]),
        k3: entries([500, 540]),
      },
    });
    expect(runRateProjection(ds, rate).projection).toBe(90);
    expect(runRateProjection(ds, stock).projection).toBe(540);
  });
  it('returns nulls with no data', () => {
    const kpi = makeKpi();
    const ds = makeDataset({ kpis: [kpi], annualTargets: { k1: 1200 } });
    const p = runRateProjection(ds, kpi);
    expect(p.projection).toBeNull();
    expect(p.rag).toBe('none');
  });
});

describe('helpers', () => {
  it('finds the latest reported month', () => {
    const ds = makeDataset({
      monthlyActuals: { k1: entries([100, 100, null, 90]) },
    });
    expect(latestReportedMonth(ds)).toBe(4);
    expect(latestReportedMonth(makeDataset())).toBe(0);
  });
  it('scores a unit by perspective for the heatmap', () => {
    const fin = makeKpi({ id: 'k1', perspectiveId: 'p1' });
    const people = makeKpi({ id: 'k2', perspectiveId: 'p2' });
    const ds = makeDataset({
      kpis: [fin, people],
      monthlyTargets: { k1: months([100]), k2: months([100]) },
      monthlyActuals: { k1: entries([120]), k2: entries([70]) },
    });
    const m1: Period = { kind: 'month', index: 1 };
    expect(unitPerspectiveScore(ds, 'u1', 'p1', m1)).toBe(120);
    expect(unitPerspectiveScore(ds, 'u1', 'p2', m1)).toBe(70);
    expect(unitPerspectiveScore(ds, 'u1', 'missing', m1)).toBeNull();
  });
});
