import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { resolvePeriodContext, type SearchParams } from '@/lib/page-params';
import { loadDataset } from '@/lib/dataset';
import {
  activeKpisForUnit,
  kpiResult,
  latestReportedMonth,
  runRateProjection,
  unitPerspectiveScore,
  unitScore,
  unitTrend,
} from '@/lib/engine';
import {
  formatAttainment,
  formatValue,
  monthName,
  periodLabel,
  periodToParam,
} from '@/lib/format';
import { PeriodBar } from '@/components/nav/period-bar';
import { TrendChart, type TrendPoint } from '@/components/analytics/trend-chart';
import { BulletChart, type BulletRow } from '@/components/analytics/bullet-chart';
import { RagDistribution, type RagRow } from '@/components/analytics/rag-distribution';
import { Heatmap, type HeatmapRow } from '@/components/analytics/heatmap';
import { RunRateChart, type RunRateRow } from '@/components/analytics/runrate-chart';
import { YoyChart, type YoyRow } from '@/components/analytics/yoy-chart';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { ragFor } from '@/lib/engine';

export const metadata = { title: 'Analytics | Workforce Group CPMS' };

const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

export default async function AnalyticsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const { ds, year, period, years } = await resolvePeriodContext(searchParams);
  if (!ds) redirect('/dashboard');
  const sp = await searchParams;

  // Operators explore their own unit; CSST and EMT see the whole group.
  const visibleUnits = ds.units.filter(
    (u) => u.active && (user.role !== 'lob' || u.id === user.unitId),
  );
  const focusUnitId =
    user.role === 'lob'
      ? user.unitId
      : (first(sp.unit) ?? visibleUnits[0]?.id);
  const focusUnit = visibleUnits.find((u) => u.id === focusUnitId) ?? visibleUnits[0];

  const latest = latestReportedMonth(ds);
  const trendData: TrendPoint[] = Array.from({ length: Math.max(latest, 1) }, (_, i) => ({
    month: monthName(i + 1),
  }));
  for (const unit of visibleUnits) {
    const trend = unitTrend(ds, unit.id, Math.max(latest, 1));
    trend.forEach((point, i) => {
      trendData[i][unit.name] = point.score === null ? null : Math.round(point.score);
    });
  }

  const bulletRows: BulletRow[] = focusUnit
    ? activeKpisForUnit(ds, focusUnit.id).map((kpi) => {
        const r = kpiResult(ds, kpi, period);
        return {
          name: kpi.name,
          attainment: r.attainment,
          rag: r.rag,
          targetLabel: formatValue(r.target, kpi.uom),
          actualLabel: formatValue(r.actual, kpi.uom),
        };
      })
    : [];

  const ragRows: RagRow[] = visibleUnits.map((unit) => {
    const row: RagRow = {
      name: unit.name,
      'On track': 0,
      'At risk': 0,
      'Off track': 0,
      'No data': 0,
    };
    for (const kpi of activeKpisForUnit(ds, unit.id)) {
      const rag = kpiResult(ds, kpi, period).rag;
      if (rag === 'green') row['On track']++;
      else if (rag === 'amber') row['At risk']++;
      else if (rag === 'red') row['Off track']++;
      else row['No data']++;
    }
    return row;
  });

  const heatmapRows: HeatmapRow[] = visibleUnits.map((unit) => ({
    unit: unit.name,
    cells: ds.perspectives.map((p) => {
      const score = unitPerspectiveScore(ds, unit.id, p.id, period);
      return { score, rag: ragFor(score) };
    }),
  }));

  const runRateRows: RunRateRow[] = focusUnit
    ? activeKpisForUnit(ds, focusUnit.id).map((kpi) => {
        const p = runRateProjection(ds, kpi);
        return {
          name: kpi.name,
          projectedAttainment: p.projectedAttainment,
          rag: p.rag,
          detail: `Projection ${formatValue(p.projection, kpi.uom)} against ${formatValue(
            p.annualTarget,
            kpi.uom,
          )} for the year, from ${p.monthsReported} reported month${p.monthsReported === 1 ? '' : 's'}.`,
        };
      })
    : [];

  // Year on year needs a prior fiscal year with data.
  const prevYear = years.includes(year - 1) ? year - 1 : null;
  const prevDs = prevYear ? await loadDataset(prevYear) : null;
  const yoyRows: YoyRow[] = prevDs
    ? visibleUnits.map((unit) => ({
        name: unit.name,
        [String(year - 1)]: prevDs ? unitScore(prevDs, unit.id, period).score : null,
        [String(year)]: unitScore(ds, unit.id, period).score,
      }))
    : [];

  const exportHref = `/api/export?year=${year}&period=${periodToParam(period)}${
    user.role === 'lob' && focusUnit ? `&unit=${focusUnit.id}` : ''
  }`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-charcoal">Analytics</h1>
          <p className="text-sm text-charcoal/60">
            {periodLabel(period, year)}: trends, distribution, and where the year is heading.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodBar years={years} year={year} period={period} />
          <a href={exportHref}>
            <Button variant="secondary" size="sm">
              Download CSV
            </Button>
          </a>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Performance trend by unit</CardTitle>
        </CardHeader>
        <CardBody>
          {latest === 0 ? (
            <p className="text-sm text-charcoal/60">No actuals reported yet this year.</p>
          ) : (
            <TrendChart data={trendData} series={visibleUnits.map((u) => u.name)} />
          )}
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Target versus actual{focusUnit ? `: ${focusUnit.name}` : ''}</CardTitle>
            {user.role !== 'lob' && visibleUnits.length > 1 && (
              <form method="get" className="flex items-center gap-1.5">
                <input type="hidden" name="year" value={year} />
                <input type="hidden" name="period" value={periodToParam(period)} />
                <Select name="unit" defaultValue={focusUnit?.id} aria-label="Unit" className="w-48 py-1.5">
                  {visibleUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
                <Button type="submit" variant="secondary" size="sm">
                  Open
                </Button>
              </form>
            )}
          </CardHeader>
          <CardBody>
            {bulletRows.length === 0 ? (
              <p className="text-sm text-charcoal/60">No KPIs for this unit yet.</p>
            ) : (
              <BulletChart rows={bulletRows} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>RAG distribution</CardTitle>
          </CardHeader>
          <CardBody>
            <RagDistribution rows={ragRows} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Unit by perspective</CardTitle>
        </CardHeader>
        <CardBody>
          <Heatmap perspectives={ds.perspectives.map((p) => p.name)} rows={heatmapRows} />
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Run rate to year end{focusUnit ? `: ${focusUnit.name}` : ''}</CardTitle>
          </CardHeader>
          <CardBody>
            {runRateRows.length === 0 ? (
              <p className="text-sm text-charcoal/60">No KPIs for this unit yet.</p>
            ) : (
              <>
                <RunRateChart rows={runRateRows} />
                <p className="text-xs text-charcoal/50 mt-2">
                  Assumption: sums continue at the average reported month, rates hold their mean,
                  levels hold their latest value.
                </p>
              </>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Year on year</CardTitle>
          </CardHeader>
          <CardBody>
            {yoyRows.length > 0 && prevYear ? (
              <YoyChart rows={yoyRows} years={[String(prevYear), String(year)]} />
            ) : (
              <p className="text-sm text-charcoal/60">
                Year-on-year comparison appears once a prior fiscal year has data. FY {year} is
                the first year in the system.
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
