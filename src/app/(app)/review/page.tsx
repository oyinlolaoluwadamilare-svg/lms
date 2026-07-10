import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { resolvePeriodContext, type SearchParams } from '@/lib/page-params';
import { unitScore } from '@/lib/engine';
import { formatAttainment, formatDate, periodLabel, submissionStatusLabel } from '@/lib/format';
import { RagBadge } from '@/components/rag-badge';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import type { Submission } from '@/lib/types';

export const metadata = { title: 'Review | Workforce Group CPMS' };

export default async function ReviewPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (user.role === 'lob') redirect('/report');

  const { ds, year } = await resolvePeriodContext(searchParams);
  if (!ds) redirect('/dashboard');

  const byRecency = (a: Submission, b: Submission) =>
    (b.submittedAt ?? '').localeCompare(a.submittedAt ?? '');
  const queue = ds.submissions.filter((s) => s.status === 'submitted').sort(byRecency);
  const decided = ds.submissions.filter((s) => s.status !== 'submitted' && s.status !== 'draft').sort(byRecency);

  const renderRows = (rows: Submission[]) =>
    rows.map((s) => {
      const unit = ds.units.find((u) => u.id === s.unitId);
      const period = { kind: s.periodKind, index: s.periodIndex } as const;
      const score = unitScore(ds, s.unitId, period);
      return (
        <TR key={s.id}>
          <TD>
            <Link
              href={`/review/${s.id}`}
              className="font-semibold text-navy hover:underline"
            >
              {unit?.name ?? 'Unknown unit'}
            </Link>
          </TD>
          <TD>{periodLabel(period, year)}</TD>
          <TD className="text-right tabular-nums font-semibold">
            {formatAttainment(score.score)}
          </TD>
          <TD>
            <RagBadge rag={score.rag} />
          </TD>
          <TD className="text-charcoal/70">
            {s.submittedAt ? formatDate(s.submittedAt) : ''}
          </TD>
          <TD className="text-charcoal/70">{submissionStatusLabel(s.status)}</TD>
          <TD>
            <Link href={`/review/${s.id}`} className="text-sm font-semibold text-navy hover:underline">
              Open
            </Link>
          </TD>
        </TR>
      );
    });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-charcoal">Review queue</h1>
        <p className="text-sm text-charcoal/60">
          Submitted periods awaiting EMT sign-off, then recent decisions.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Awaiting review ({queue.length})</CardTitle>
        </CardHeader>
        <CardBody className="px-0">
          {queue.length === 0 ? (
            <p className="px-5 pb-2 text-sm text-charcoal/60">
              Nothing is waiting. Units appear here the moment they submit a period.
            </p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Unit</TH>
                  <TH>Period</TH>
                  <TH className="text-right">Score</TH>
                  <TH>Status</TH>
                  <TH>Submitted</TH>
                  <TH>State</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>{renderRows(queue)}</TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent decisions</CardTitle>
        </CardHeader>
        <CardBody className="px-0">
          {decided.length === 0 ? (
            <p className="px-5 pb-2 text-sm text-charcoal/60">No decisions yet this year.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Unit</TH>
                  <TH>Period</TH>
                  <TH className="text-right">Score</TH>
                  <TH>Status</TH>
                  <TH>Submitted</TH>
                  <TH>State</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>{renderRows(decided)}</TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
