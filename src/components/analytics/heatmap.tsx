import { cn } from '@/lib/cn';
import type { Rag } from '@/lib/types';

export interface HeatmapCell {
  score: number | null;
  rag: Rag;
}

export interface HeatmapRow {
  unit: string;
  cells: HeatmapCell[];
}

const cellStyles: Record<Rag, string> = {
  green: 'bg-rag-green-bg text-rag-green',
  amber: 'bg-rag-amber-bg text-rag-amber',
  red: 'bg-rag-red-bg text-rag-red',
  none: 'bg-rag-none-bg text-rag-none',
};

/** Unit-by-perspective heatmap. Every cell carries its number, so the
 *  colour is reinforcement, never the only signal. */
export function Heatmap({ perspectives, rows }: { perspectives: string[]; rows: HeatmapRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            <th className="py-2 px-3 text-left text-xs font-bold uppercase tracking-wide text-charcoal/60">
              Unit
            </th>
            {perspectives.map((p) => (
              <th
                key={p}
                className="py-2 px-2 text-center text-xs font-bold uppercase tracking-wide text-charcoal/60"
              >
                {p}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.unit}>
              <td className="py-1.5 px-3 font-semibold text-charcoal whitespace-nowrap">
                {row.unit}
              </td>
              {row.cells.map((cell, i) => (
                <td key={i} className="p-1">
                  <div
                    className={cn(
                      'rounded-md px-2 py-2 text-center font-bold tabular-nums',
                      cellStyles[cell.rag],
                    )}
                  >
                    {cell.score === null ? '–' : `${Math.round(cell.score)}%`}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
