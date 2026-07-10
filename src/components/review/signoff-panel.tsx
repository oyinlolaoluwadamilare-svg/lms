'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { approveSubmission, returnSubmission } from '@/actions/submissions';
import { Button } from '@/components/ui/button';
import { Select, Textarea } from '@/components/ui/input';

/** EMT decision controls: sign off with a rating, or return with a comment. */
export function SignoffPanel({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const [rating, setRating] = useState('4');
  const [comment, setComment] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [assist, setAssist] = useState<string | null>(null);
  const [assisting, setAssisting] = useState(false);

  async function reviewAssist() {
    setAssisting(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/review-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId }),
      });
      const data = await res.json();
      if (data.configured === false) setError(data.message);
      else if (data.error) setError(data.error);
      else setAssist(data.result ?? '');
    } catch {
      setError('The assistant could not be reached.');
    } finally {
      setAssisting(false);
    }
  }

  function run(kind: 'approve' | 'return') {
    const fd = new FormData();
    fd.set('id', submissionId);
    fd.set('rating', rating);
    fd.set('comment', comment);
    setError(null);
    startTransition(async () => {
      try {
        await (kind === 'approve' ? approveSubmission(fd) : returnSubmission(fd));
        router.push('/review');
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The decision could not be saved.');
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-charcoal/50">
          The assistant can suggest questions for the unit and a rating rationale. You decide.
        </p>
        <Button variant="ghost" size="sm" disabled={assisting} onClick={reviewAssist}>
          {assisting ? 'Thinking…' : '✦ Review assist'}
        </Button>
      </div>
      {assist && (
        <div className="text-sm text-charcoal/80 whitespace-pre-wrap bg-surface rounded-lg p-3 border border-line">
          {assist}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <div>
          <label htmlFor="rating" className="block text-sm font-semibold text-charcoal mb-1">
            Rating
          </label>
          <Select id="rating" value={rating} onChange={(e) => setRating(e.target.value)}>
            {[5, 4, 3, 2, 1].map((r) => (
              <option key={r} value={r}>
                {r} of 5
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="comment" className="block text-sm font-semibold text-charcoal mb-1">
            Comment
          </label>
          <Textarea
            id="comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Required when returning: tell the unit exactly what to address."
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={pending} onClick={() => run('approve')}>
          {pending ? 'Working…' : 'Sign off'}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={() => run('return')}>
          Return to unit
        </Button>
        {error && (
          <span role="alert" className="text-sm text-rag-red font-semibold">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
