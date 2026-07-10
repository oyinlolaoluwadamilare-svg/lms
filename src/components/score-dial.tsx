import { RagBadge } from './rag-badge';
import { formatAttainment } from '@/lib/format';
import type { Rag } from '@/lib/types';

const ringColors: Record<Rag, string> = {
  green: 'text-rag-green',
  amber: 'text-rag-amber',
  red: 'text-rag-red',
  none: 'text-rag-none',
};

/** The headline score: a ring filled to the attainment percentage,
 *  the number in the middle, the RAG spelled out underneath. */
export function ScoreDial({
  score,
  rag,
  label,
  size = 148,
}: {
  score: number | null;
  rag: Rag;
  label: string;
  size?: number;
}) {
  const pct = score === null ? 0 : Math.min(score, 100);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const dash = (pct / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`${label}: ${formatAttainment(score)}`}>
          <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--color-line)" strokeWidth="9" />
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            transform="rotate(-90 50 50)"
            className={ringColors[rag]}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-charcoal">{formatAttainment(score)}</span>
        </div>
      </div>
      <RagBadge rag={rag} />
      <p className="text-sm text-charcoal/60 font-semibold">{label}</p>
    </div>
  );
}
