import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { resolvePeriodContext, submissionFor, type SearchParams } from '@/lib/page-params';
import {
  activeKpisForUnit,
  kpiResult,
  missingEntries,
  monthsInPeriod,
  unitScore,
} from '@/lib/engine';
import { monthName, periodLabel, periodToParam } from '@/lib/format';
import { PeriodBar } from '@/components/nav/period-bar';
import { MonthPicker } from '@/components/report/month-picker';
import { ActualsGrid, type ActualsRow } from '@/components/report/actuals-grid';
import { SubmitPanel } from '@/components/report/submit-panel';
import { InitiativeManager } from '@/components/report/initiative-manager';
import { KpiTable } from '@/components/unit/kpi-table';
import { AiPanel } from '@/components/ai/ai-panel';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import type { KpiResult } from '@/lib/types';

export const metadata = { title: 'Report actuals | Workforce Group CPMS' };

const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

export default async function ReportPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (user.role === 'emt') redirect('/review');

  const { ds, year, period, years } = await resolvePeriodContext(searchParams);
  if (!ds) redirect('/dashboard');

  const sp = await searchParams;
  // Operators report their own unit; CSST can open any unit's workspace.
  const requestedUnit = first(sp.unit);
  const unitId = user.role === 'lob' ? user.unitId : (requestedUnit ?? ds.units[0]?.id);
  const unit = ds.units.find((u) => u.id === unitId);
  if (!unitId || !unit) redirect('/dashboard');

  const kpisForUnit = activeKpisForUnit(ds, unitId);

  // Default entry month: the first month with anything still missing, else
  // the month after the unit's latest reported month.
  let unitLatest = 0;
  let firstGap = 0;
  for (let m = 1; m <= 12 && firstGap === 0; m++) {
    const anyMissing = kpisForUnit.some(
      (k) => k.cadence === 'continuous' && (ds.monthlyActuals[k.id]?.[m - 1]?.value ?? null) === null,
    );
    const anyReported = kpisForUnit.some(
      (k) => (ds.monthlyActuals[k.id]?.[m - 1]?.value ?? null) !== null,
    );
    if (anyReported) unitLatest = m;
    if (anyMissing && (anyReported || m <= unitLatest + 1)) firstGap = m;
  }
  const defaultMonth = Math.min(firstGap || unitLatest + 1 || 1, 12);
  const requestedMonth = Number(first(sp.m));
  const month =
    Number.isInteger(requestedMonth) && requestedMonth >= 1 && requestedMonth <= 12
      ? requestedMonth
      : defaultMonth;

  const rows: ActualsRow[] = kpisForUnit.map((k) => {
    const entry = ds.monthlyActuals[k.id]?.[month - 1];
    return {
      kpiId: k.id,
      name: k.name,
      uom: k.uom,
      direction: k.direction,
      oneOff: k.cadence === 'one_off',
      target: ds.monthlyTargets[k.id]?.[month - 1] ?? ds.annualTargets[k.id] ?? null,
      value: entry?.value ?? null,
      note: entry?.note ?? null,
    };
  });

  const score = unitScore(ds, unitId, period);
  const results = new Map<string, KpiResult>(score.kpiResults.map((r) => [r.kpiId, r]));
  const missing = missingEntries(ds, unitId, period);
  const submission = submissionFor(ds, unitId, period);
  const unitInitiatives = ds.initiatives.filter((i) => i.unitId === unitId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-charcoal">Report actuals</h1>
          <p className="text-sm text-charcoal/60">
            {unit.name}: enter one value per KPI per month, then submit the period for EMT
            review.
          </p>
        </div>
        {user.role === 'csst' && (
          <form method="get" className="flex items-center gap-2">
            <Select name="unit" defaultValue={unitId} aria-label="Unit" className="w-56">
              {ds.units
                .filter((u) => u.active)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </Select>
            <button type="submit" className="text-sm font-semibold text-navy cursor-pointer">
              Open
            </button>
          </form>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Monthly entry: {monthName(month)} {year}</CardTitle>
          <MonthPicker month={month} />
        </CardHeader>
        <CardBody className="px-0 pb-2">
          <ActualsGrid rows={rows} month={month} year={year} unitId={unitId} />
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-charcoal">
          Period review: {periodLabel(period, year)}
        </h2>
        <PeriodBar years={years} year={year} period={period} />
      </div>

      {missing.length > 0 ? (
        <Card className="p-4 bg-rag-amber-bg border-rag-amber/30">
          <p className="text-sm font-bold text-rag-amber mb-1">
            Still missing for {periodLabel(period, year)}
          </p>
          <ul className="text-sm text-charcoal/80 space-y-0.5">
            {missing.map((m) => {
              const kpi = kpisForUnit.find((k) => k.id === m.kpiId);
              return (
                <li key={m.kpiId}>
                  <span className="font-semibold">{kpi?.name}</span>:{' '}
                  {kpi?.cadence === 'one_off'
                    ? 'deliverable not yet reported'
                    : m.months.map((mm) => monthName(mm)).join(', ')}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : (
        <Card className="p-4 bg-rag-green-bg border-rag-green/30">
          <p className="text-sm font-bold text-rag-green">
            All KPIs reported for {periodLabel(period, year)}.
          </p>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Target versus actual, {periodLabel(period, year)}</CardTitle>
        </CardHeader>
        <CardBody className="px-0">
          <KpiTable ds={ds} kpis={kpisForUnit} results={results} period={period} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Submit {periodLabel(period, year)} for review</CardTitle>
        </CardHeader>
        <CardBody>
          <SubmitPanel unitId={unitId} year={year} period={period} submission={submission} />
        </CardBody>
      </Card>

      <AiPanel
        title="Suggest corrective initiatives"
        description="Reads the at-risk and off-track KPIs and proposes practical fixes. You decide what to add."
        endpoint="/api/ai/suggest-initiatives"
        payload={{ unitId, year, period: periodToParam(period) }}
        buttonLabel="Suggest initiatives"
      />

      <Card>
        <CardHeader>
          <CardTitle>Initiatives</CardTitle>
        </CardHeader>
        <CardBody>
          <InitiativeManager
            initiatives={unitInitiatives}
            kpis={kpisForUnit}
            unitId={unitId}
            year={year}
          />
        </CardBody>
      </Card>
    </div>
  );
}
