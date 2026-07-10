import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { getDefaultYear, loadDataset } from '@/lib/dataset';
import { activeKpisForUnit, missingEntries, unitScore } from '@/lib/engine';
import { formatDate, periodLabel, submissionStatusLabel } from '@/lib/format';
import { ScoreDial } from '@/components/score-dial';
import { KpiTable } from '@/components/unit/kpi-table';
import { InitiativeList } from '@/components/unit/initiative-list';
import { SignoffPanel } from '@/components/review/signoff-panel';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import type { KpiResult, Period } from '@/lib/types';

export const metadata = { title: 'Review submission | Workforce Group CPMS' };

export default async function ReviewDetailPage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const user = await requireUser();
  if (user.role === 'lob') redirect('/report');

  const { submissionId } = await params;
  const year = await getDefaultYear();
  const ds = await loadDataset(year);
  if (!ds) notFound();

  const submission = ds.submissions.find((s) => s.id === submissionId);
  if (!submission) notFound();
  const unit = ds.units.find((u) => u.id === submission.unitId);
  if (!unit) notFound();

  const period: Period = { kind: submission.periodKind, index: submission.periodIndex };
  const score = unitScore(ds, unit.id, period);
  const results = new Map<string, KpiResult>(score.kpiResults.map((r) => [r.kpiId, r]));
  const kpisForUnit = activeKpisForUnit(ds, unit.id);
  const missing = missingEntries(ds, unit.id, period);
  const unitInitiatives = ds.initiatives.filter((i) => i.unitId === unit.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-charcoal/50">
            <Link href="/review" className="hover:underline">
              Review
            </Link>{' '}
            / {submissionStatusLabel(submission.status)}
          </p>
          <h1 className="text-xl font-bold text-charcoal">
            {unit.name}: {periodLabel(period, year)}
          </h1>
          <p className="text-sm text-charcoal/60">
            {submission.submittedAt
              ? `Submitted ${formatDate(submission.submittedAt)}.`
              : 'Not yet submitted.'}
            {submission.reviewedAt ? ` Reviewed ${formatDate(submission.reviewedAt)}.` : ''}
          </p>
        </div>
        <Link href={`/units/${unit.id}`} className="text-sm font-semibold text-navy hover:underline">
          Open unit detail
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[auto_1fr] items-start">
        <Card className="p-6 flex items-center justify-center">
          <ScoreDial score={score.score} rag={score.rag} label="Unit score for the period" />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>The unit&apos;s narrative</CardTitle>
          </CardHeader>
          <CardBody>
            {submission.narrative ? (
              <p className="text-sm text-charcoal/80 whitespace-pre-line">{submission.narrative}</p>
            ) : (
              <p className="text-sm text-charcoal/60">No narrative was provided.</p>
            )}
            {missing.length > 0 && (
              <p className="mt-3 text-sm bg-rag-amber-bg text-rag-amber rounded-lg px-3 py-2">
                {missing.length} KPI{missing.length === 1 ? ' is' : 's are'} missing data in this
                period. Consider returning the report if the gaps matter.
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>The numbers, {periodLabel(period, year)}</CardTitle>
        </CardHeader>
        <CardBody className="px-0">
          <KpiTable ds={ds} kpis={kpisForUnit} results={results} period={period} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Initiatives</CardTitle>
        </CardHeader>
        <CardBody>
          <InitiativeList ds={ds} initiatives={unitInitiatives} />
        </CardBody>
      </Card>

      {submission.status === 'submitted' && user.role === 'emt' ? (
        <Card>
          <CardHeader>
            <CardTitle>Decision</CardTitle>
          </CardHeader>
          <CardBody>
            <SignoffPanel submissionId={submission.id} />
          </CardBody>
        </Card>
      ) : submission.status !== 'submitted' ? (
        <Card>
          <CardHeader>
            <CardTitle>Decision</CardTitle>
          </CardHeader>
          <CardBody className="text-sm text-charcoal/70 space-y-1">
            <p className="font-semibold text-charcoal">
              {submissionStatusLabel(submission.status)}
              {submission.rating !== null ? `, rated ${submission.rating} of 5` : ''}
            </p>
            {submission.reviewComment && <p>{submission.reviewComment}</p>}
          </CardBody>
        </Card>
      ) : (
        <Card className="p-4">
          <p className="text-sm text-charcoal/60">
            Awaiting an EMT decision. Administrators can read but not sign off.
          </p>
        </Card>
      )}
    </div>
  );
}
