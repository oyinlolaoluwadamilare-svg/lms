import { RagBadge } from '@/components/rag-badge';

export function StatusCounts({
  counts,
}: {
  counts: { onTrack: number; atRisk: number; offTrack: number; noData: number };
}) {
  const items = [
    { rag: 'green' as const, count: counts.onTrack },
    { rag: 'amber' as const, count: counts.atRisk },
    { rag: 'red' as const, count: counts.offTrack },
    { rag: 'none' as const, count: counts.noData },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {items.map((item) => (
        <div key={item.rag} className="bg-card rounded-xl border border-line p-3 text-center">
          <p className="text-2xl font-bold text-charcoal tabular-nums">{item.count}</p>
          <RagBadge rag={item.rag} />
          <p className="text-[0.65rem] text-charcoal/50 font-semibold mt-1 uppercase tracking-wide">
            KPIs
          </p>
        </div>
      ))}
    </div>
  );
}
