import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { resolvePeriodContext, submissionFor, type SearchParams } from '@/lib/page-params';
import { kpiResult, unitScore } from '@/lib/engine';
import { formatDate, periodLabel, submissionStatusLabel } from '@/lib/format';
import { PeriodBar } from '@/components/nav/period-bar';
import { ScoreDial } from '@/components/score-dial';
import { KpiTable } from '@/components/unit/kpi-table';
import { InitiativeList } from '@/components/unit/initiative-list';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import type { KpiResult } from '@/lib/types';

export const metadata = { title: 'Unit detail | Workforce Group CPMS' };

export default async function UnitDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ unitId: string }>;
  searchParams: SearchParams;
}) {
  const user = await requireUser();
  const { unitId } = await params;
  // Operators may only open their own unit.
  if (user.role === 'lob' && user.unitId !== unitId) redirect('/report');

  const { ds, year, period, years } = await resolvePeriodContext(searchParams);
  if (!ds) notFound();
  const unit = ds.units.find((u) => u.id === unitId);
  if (!unit) notFound();

  const score = unitScore(ds, unitId, period);
  const results = new Map<string, KpiResult>(score.kpiResults.map((r) => [r.kpiId, r]));
  const aspiration = ds.aspirations.find((a) => a.unitId === unitId);
  const submission = submissionFor(ds, unitId, period);
  const unitObjectives = ds.objectives
    .filter((o) => o.unitId === unitId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const unitInitiatives = ds.initiatives.filter((i) => i.unitId === unitId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-charcoal/50">{unit.type}</p>
          <h1 className="text-xl font-bold text-charcoal">{unit.name}</h1>
          {aspiration && <p className="text-sm text-charcoal/60 max-w-xl">{aspiration.text}</p>}
        </div>
        <PeriodBar years={years} year={year} period={period} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[auto_1fr] items-start">
        <Card className="p-6 flex items-center justify-center">
          <ScoreDial
            score={score.score}
            rag={score.rag}
            label={`Unit score, ${periodLabel(period, year)}`}
          />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Reporting status</CardTitle>
          </CardHeader>
          <CardBody className="text-sm text-charcoal/70 space-y-1">
            {submission ? (
              <>
                <p>
                  <span className="font-semibold text-charcoal">
                    {submissionStatusLabel(submission.status)}
                  </span>{' '}
                  for {periodLabel(period, year)}
                  {submission.submittedAt ? `, submitted ${formatDate(submission.submittedAt)}` : ''}
                  {submission.reviewedAt ? `, reviewed ${formatDate(submission.reviewedAt)}` : ''}.
                </p>
                {submission.rating !== null && <p>EMT rating: {submission.rating} of 5.</p>}
                {submission.reviewComment && <p>EMT comment: {submission.reviewComment}</p>}
                {submission.narrative && (
                  <p className="pt-1 border-t border-line mt-2">{submission.narrative}</p>
                )}
              </>
            ) : (
              <p>
                No report has been started for {periodLabel(period, year)}. The unit MD reports
                actuals monthly and submits the period for EMT review.
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      {unitObjectives.map((objective) => {
        const parent = ds.objectives.find((o) => o.id === objective.parentId);
        const objectiveKpis = ds.kpis.filter(
          (k) => k.objectiveId === objective.id && k.active,
        );
        const krs = ds.keyResults.filter((kr) => kr.objectiveId === objective.id);
        return (
          <Card key={objective.id}>
            <CardHeader className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <CardTitle>{objective.title}</CardTitle>
                <p className="text-xs text-charcoal/50 mt-0.5">
                  {objective.framework}
                  {parent ? `, under group objective: ${parent.title}` : ''}
                </p>
              </div>
              <span className="text-xs font-bold text-charcoal/50">
                Weight {objective.weight}
              </span>
            </CardHeader>
            <CardBody>
              {krs.length > 0 && (
                <ul className="mb-3 space-y-1">
                  {krs.map((kr) => (
                    <li key={kr.id} className="text-sm text-charcoal/70">
                      <span className="font-semibold text-charcoal">Key result:</span> {kr.title}
                      {kr.targetText ? ` (target: ${kr.targetText})` : ''}
                      {kr.currentText ? `. Now: ${kr.currentText}` : ''}
                    </li>
                  ))}
                </ul>
              )}
              {objectiveKpis.length > 0 ? (
                <KpiTable ds={ds} kpis={objectiveKpis} results={results} period={period} />
              ) : (
                <p className="text-sm text-charcoal/60">No KPIs are defined under this objective yet.</p>
              )}
            </CardBody>
          </Card>
        );
      })}

      <Card>
        <CardHeader>
          <CardTitle>Initiatives</CardTitle>
        </CardHeader>
        <CardBody>
          <InitiativeList ds={ds} initiatives={unitInitiatives} />
        </CardBody>
      </Card>
    </div>
  );
}
