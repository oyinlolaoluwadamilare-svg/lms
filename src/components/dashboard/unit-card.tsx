import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { RagBadge } from '@/components/rag-badge';
import { formatAttainment, submissionStatusLabel } from '@/lib/format';
import type { Rag, SubmissionStatus, UnitType } from '@/lib/types';

export function UnitCard({
  href,
  name,
  type,
  score,
  rag,
  aspiration,
  submissionStatus,
}: {
  href: string;
  name: string;
  type: UnitType;
  score: number | null;
  rag: Rag;
  aspiration: string | null;
  submissionStatus: SubmissionStatus | null;
}) {
  return (
    <Link href={href} className="block group">
      <Card className="p-4 h-full transition-shadow group-hover:shadow-md group-hover:border-midblue">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-bold text-charcoal group-hover:text-navy">{name}</p>
            <p className="text-xs text-charcoal/50 font-semibold uppercase tracking-wide">{type}</p>
          </div>
          <span className="text-2xl font-bold text-charcoal tabular-nums">
            {formatAttainment(score)}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <RagBadge rag={rag} />
          <span className="text-xs text-charcoal/60 font-semibold">
            {submissionStatus ? submissionStatusLabel(submissionStatus) : 'Not yet reported'}
          </span>
        </div>
        {aspiration && (
          <p className="mt-3 text-sm text-charcoal/70 leading-snug line-clamp-2">{aspiration}</p>
        )}
      </Card>
    </Link>
  );
}
