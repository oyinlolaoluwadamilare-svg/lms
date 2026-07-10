import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { resolvePeriodContext, type SearchParams } from '@/lib/page-params';
import { saveAnnualTarget, saveMonthlyTargets } from '@/actions/targets';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { MONTHS } from '@/lib/format';

export const metadata = { title: 'Targets | Workforce Group CPMS' };

const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

export default async function TargetsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (user.role === 'emt') redirect('/dashboard');

  const { ds, year } = await resolvePeriodContext(searchParams);
  if (!ds) redirect('/dashboard');
  const sp = await searchParams;

  const activeUnits = ds.units.filter((u) => u.active);
  const unitId = user.role === 'lob' ? user.unitId : (first(sp.unit) ?? activeUnits[0]?.id);
  const unit = activeUnits.find((u) => u.id === unitId);
  if (!unit) redirect('/dashboard');

  const unitKpis = ds.kpis.filter((k) => k.unitId === unit.id && k.active);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-charcoal">Targets, FY {year}</h1>
          <p className="text-sm text-charcoal/60">
            {unit.name}: the annual figure, phased across twelve months so each month is judged
            fairly.
          </p>
        </div>
        {user.role === 'csst' && (
          <form method="get" className="flex items-center gap-2">
            <Select name="unit" defaultValue={unit.id} aria-label="Unit" className="w-56">
              {activeUnits.map((u) => (
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
      </div>

      {unitKpis.map((kpi) => {
        const annual = ds.annualTargets[kpi.id] ?? null;
        const monthly = ds.monthlyTargets[kpi.id] ?? Array(12).fill(null);
        return (
          <Card key={kpi.id}>
            <CardHeader className="flex flex-wrap items-baseline justify-between gap-2">
              <CardTitle>{kpi.name}</CardTitle>
              <span className="text-xs text-charcoal/50 font-semibold">
                {kpi.uom}, {kpi.aggregation === 'sum' ? 'summed' : kpi.aggregation === 'average' ? 'averaged' : 'period end'}
                {kpi.direction === 'lower' ? ', lower is better' : ''}
              </span>
            </CardHeader>
            <CardBody className="space-y-3">
              <form action={saveAnnualTarget} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="kpiId" value={kpi.id} />
                <input type="hidden" name="year" value={year} />
                <div>
                  <Label htmlFor={`annual-${kpi.id}`}>Annual target</Label>
                  <Input
                    id={`annual-${kpi.id}`}
                    name="value"
                    inputMode="decimal"
                    defaultValue={annual ?? ''}
                    className="w-36"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor={`phasing-${kpi.id}`}>Monthly phasing</Label>
                  <Select id={`phasing-${kpi.id}`} name="phasing" defaultValue="keep" className="w-56">
                    <option value="keep">Keep months as they are</option>
                    <option value="even">
                      {kpi.aggregation === 'sum' ? 'Spread evenly' : 'Hold the annual figure'}
                    </option>
                    {kpi.aggregation === 'sum' && (
                      <option value="seasonal">Seasonal revenue curve</option>
                    )}
                  </Select>
                </div>
                <Button type="submit" variant="secondary">
                  Save annual target
                </Button>
              </form>

              {kpi.cadence === 'continuous' && (
                <form action={saveMonthlyTargets} className="space-y-2">
                  <input type="hidden" name="kpiId" value={kpi.id} />
                  <input type="hidden" name="year" value={year} />
                  <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-12 gap-1.5">
                    {MONTHS.map((m, i) => (
                      <div key={m}>
                        <label
                          htmlFor={`mt-${kpi.id}-${i + 1}`}
                          className="block text-[0.65rem] font-bold text-charcoal/50 uppercase"
                        >
                          {m}
                        </label>
                        <Input
                          id={`mt-${kpi.id}-${i + 1}`}
                          name={`m${i + 1}`}
                          inputMode="decimal"
                          defaultValue={monthly[i] ?? ''}
                          className="px-1.5 py-1 text-xs"
                        />
                      </div>
                    ))}
                  </div>
                  <Button type="submit" variant="ghost" size="sm">
                    Save monthly targets
                  </Button>
                </form>
              )}
            </CardBody>
          </Card>
        );
      })}
      {unitKpis.length === 0 && (
        <Card className="p-6">
          <p className="text-sm text-charcoal/60">
            No KPIs yet for this unit. Create them in Administration first.
          </p>
        </Card>
      )}
    </div>
  );
}
