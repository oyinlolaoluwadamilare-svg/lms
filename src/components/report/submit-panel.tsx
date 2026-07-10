'use client';

import { useState, useTransition } from 'react';
import { saveDraftNarrative, submitPeriod } from '@/actions/submissions';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { periodLabel, submissionStatusLabel } from '@/lib/format';
import type { Period, Submission } from '@/lib/types';

/** Narrative plus submit. Drafts save without locking; submitting sends the
 *  period to the EMT. Returned reports show the EMT's comment to address. */
export function SubmitPanel({
  unitId,
  year,
  period,
  submission,
}: {
  unitId: string;
  year: number;
  period: Period;
  submission: Submission | null;
}) {
  const [narrative, setNarrative] = useState(submission?.narrative ?? '');
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);

  const status = submission?.status ?? null;
  const locked = status === 'submitted' || status === 'approved';

  async function draftWithAI() {
    setDrafting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/ai/narrative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unitId,
          year,
          period: `${period.kind === 'year' ? 'year' : period.kind[0] + period.index}`,
        }),
      });
      const data = await res.json();
      if (data.configured === false) {
        setError(data.message);
      } else if (data.error) {
        setError(data.error);
      } else {
        setNarrative(data.result ?? '');
        setMessage('Draft generated. Edit it before submitting; it is not saved yet.');
      }
    } catch {
      setError('The assistant could not be reached.');
    } finally {
      setDrafting(false);
    }
  }

  function run(action: (fd: FormData) => Promise<void>, success: string) {
    const fd = new FormData();
    fd.set('year', String(year));
    fd.set('unit', unitId);
    fd.set('periodKind', period.kind);
    fd.set('periodIndex', String(period.index));
    fd.set('narrative', narrative);
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        await action(fd);
        setMessage(success);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-charcoal/70">
          Reporting <span className="font-bold text-charcoal">{periodLabel(period, year)}</span>
        </p>
        {status && (
          <span className="text-xs font-bold uppercase tracking-wide text-charcoal/60">
            {submissionStatusLabel(status)}
          </span>
        )}
      </div>

      {status === 'returned' && submission?.reviewComment && (
        <p className="text-sm bg-rag-amber-bg text-rag-amber rounded-lg px-3 py-2">
          Returned by the EMT: {submission.reviewComment}
        </p>
      )}
      {status === 'approved' && (
        <p className="text-sm bg-rag-green-bg text-rag-green rounded-lg px-3 py-2">
          Signed off{submission?.rating ? ` with a rating of ${submission.rating} of 5` : ''}
          {submission?.reviewComment ? `: ${submission.reviewComment}` : '.'}
        </p>
      )}
      {status === 'submitted' && (
        <p className="text-sm bg-sky/15 text-navy rounded-lg px-3 py-2">
          With the EMT for review. The narrative is locked until they respond.
        </p>
      )}

      <Textarea
        aria-label="Reporting note"
        value={narrative}
        onChange={(e) => setNarrative(e.target.value)}
        disabled={locked || pending}
        placeholder="The short story behind the numbers: what went well, what did not, and what you are doing about it."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" disabled={locked || pending || drafting} onClick={draftWithAI}>
          {drafting ? 'Drafting…' : '✦ Draft with AI'}
        </Button>
        <Button
          variant="secondary"
          disabled={locked || pending}
          onClick={() => run(saveDraftNarrative, 'Draft saved.')}
        >
          Save draft
        </Button>
        <Button
          disabled={locked || pending}
          onClick={() => run(submitPeriod, 'Submitted for EMT review.')}
        >
          {pending ? 'Working…' : 'Submit for review'}
        </Button>
        {message && <span className="text-sm text-rag-green font-semibold">{message}</span>}
        {error && (
          <span role="alert" className="text-sm text-rag-red font-semibold">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
