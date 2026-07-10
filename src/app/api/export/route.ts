import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getDefaultYear, loadDataset } from '@/lib/dataset';
import { activeKpisForUnit, defaultPeriod, kpiResult } from '@/lib/engine';
import { parsePeriodParam, periodToParam, ragLabel } from '@/lib/format';
import { toCsv } from '@/lib/csv';

const round2 = (v: number | null): number | null =>
  v === null ? null : Math.round(v * 100) / 100;

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const year = Number(params.get('year')) || (await getDefaultYear());
  const ds = await loadDataset(year);
  if (!ds) return NextResponse.json({ error: `No fiscal year ${year}.` }, { status: 404 });
  const period = parsePeriodParam(params.get('period'), defaultPeriod(ds));

  // Operators export their own unit only; CSST and EMT the whole group.
  const requestedUnit = params.get('unit');
  const units = ds.units.filter((u) => {
    if (!u.active) return false;
    if (user.role === 'lob') return u.id === user.unitId;
    return requestedUnit ? u.id === requestedUnit : true;
  });

  const rows = units.flatMap((unit) =>
    activeKpisForUnit(ds, unit.id).map((kpi) => {
      const r = kpiResult(ds, kpi, period);
      const perspective = ds.perspectives.find((p) => p.id === kpi.perspectiveId);
      return {
        year,
        period: periodToParam(period),
        unit: unit.name,
        kpi: kpi.name,
        perspective: perspective?.name ?? '',
        uom: kpi.uom,
        direction: kpi.direction,
        aggregation: kpi.aggregation,
        cadence: kpi.cadence,
        weight: kpi.weight,
        target: round2(r.target),
        actual: round2(r.actual),
        attainment_pct: round2(r.attainment),
        status: ragLabel(r.rag),
        months_reported: r.monthsReported,
      };
    }),
  );

  const csv = toCsv(rows);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cpms-${year}-${periodToParam(period)}.csv"`,
    },
  });
}
