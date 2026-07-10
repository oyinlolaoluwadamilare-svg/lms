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
