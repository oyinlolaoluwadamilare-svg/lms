import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { resolvePeriodContext, submissionFor, type SearchParams } from '@/lib/page-params';
import { groupScore, statusCounts } from '@/lib/engine';
import { periodLabel, periodToParam } from '@/lib/format';
import { PeriodBar } from '@/components/nav/period-bar';
import { ScoreDial } from '@/components/score-dial';
import { StatusCounts } from '@/components/dashboard/status-counts';
import { UnitCard } from '@/components/dashboard/unit-card';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata = { title: 'Group dashboard | Workforce Group CPMS' };

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (user.role === 'lob') redirect('/report');

  const { ds, year, period, years } = await resolvePeriodContext(searchParams);
  if (!ds) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No fiscal year is set up yet</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-charcoal/70">
            Ask the Corporate Strategy Support Team to create a fiscal year and the scorecard in
            Administration, or run the demo seed.
          </p>
        </CardBody>
      </Card>
    );
  }

  const group = groupScore(ds, period);
  const counts = statusCounts(ds, period);
  const activeUnits = ds.units.filter((u) => u.active);
  const laggards = group.unitScores
    .filter((u) => u.score !== null && u.score < 80)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-charcoal">Group performance</h1>
          <p className="text-sm text-charcoal/60">
            {periodLabel(period, year)} against plan, live from unit reporting.
          </p>
        </div>
        <PeriodBar years={years} year={year} period={period} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[auto_1fr] items-start">
        <Card className="p-6 flex items-center justify-center">
          <ScoreDial score={group.score} rag={group.rag} label="Group score" />
        </Card>
        <div className="space-y-4">
          <StatusCounts counts={counts} />
          {laggards.length > 0 && (
            <Card className="p-4">
              <p className="text-sm font-bold text-charcoal mb-1">Where the risk is</p>
              <p className="text-sm text-charcoal/70">
                {laggards
                  .map((l) => {
                    const unit = activeUnits.find((u) => u.id === l.unitId);
                    return `${unit?.name ?? 'Unknown'} (${Math.round(l.score ?? 0)}%)`;
                  })
                  .join(', ')}{' '}
                {laggards.length === 1 ? 'is' : 'are'} pulling the group score down for this
                period.
              </p>
            </Card>
          )}
        </div>
      </div>

      <section aria-label="Business units" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {activeUnits.map((unit) => {
          const us = group.unitScores.find((s) => s.unitId === unit.id);
          const aspiration = ds.aspirations.find((a) => a.unitId === unit.id);
          const submission = submissionFor(ds, unit.id, period);
          return (
            <UnitCard
              key={unit.id}
              href={`/units/${unit.id}?year=${year}&period=${periodToParam(period)}`}
              name={unit.name}
              type={unit.type}
              score={us?.score ?? null}
              rag={us?.rag ?? 'none'}
              aspiration={aspiration?.text ?? null}
              submissionStatus={submission?.status ?? null}
            />
          );
        })}
      </section>
    </div>
  );
}
