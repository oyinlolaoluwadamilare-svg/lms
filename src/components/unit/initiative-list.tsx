import { cn } from '@/lib/cn';
import { formatDate, initiativeStatusLabel } from '@/lib/format';
import type { Dataset, Initiative } from '@/lib/types';

const statusStyles: Record<Initiative['status'], string> = {
  done: 'text-rag-green bg-rag-green-bg',
  in_progress: 'text-navy bg-sky/15',
  not_started: 'text-rag-none bg-rag-none-bg',
  blocked: 'text-rag-red bg-rag-red-bg',
};

export function InitiativeList({
  ds,
  initiatives,
}: {
  ds: Dataset;
  initiatives: Initiative[];
}) {
  if (initiatives.length === 0) {
    return (
      <p className="text-sm text-charcoal/60">
        No initiatives yet. Initiatives are the actions a unit owns to fix or grow a KPI.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {initiatives.map((init) => {
        const kpi = ds.kpis.find((k) => k.id === init.kpiId);
        return (
          <li key={init.id} className="flex flex-wrap items-start justify-between gap-2 border-b border-line pb-3 last:border-0 last:pb-0">
            <div className="min-w-0">
              <p className="font-semibold text-charcoal text-sm">{init.title}</p>
              <p className="text-xs text-charcoal/60">
                {kpi ? `KPI: ${kpi.name}. ` : ''}
                Owner: {init.owner}
                {init.dueDate ? `. Due ${formatDate(init.dueDate)}` : ''}
              </p>
              {init.note && <p className="text-xs text-charcoal/70 mt-1">{init.note}</p>}
            </div>
            <span
              className={cn(
                'text-xs font-bold rounded-full px-2 py-0.5 whitespace-nowrap',
                statusStyles[init.status],
              )}
            >
              {initiativeStatusLabel(init.status)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
