import { cn } from '@/lib/cn';
import { ragLabel } from '@/lib/format';
import type { Rag } from '@/lib/types';

const styles: Record<Rag, string> = {
  green: 'text-rag-green bg-rag-green-bg',
  amber: 'text-rag-amber bg-rag-amber-bg',
  red: 'text-rag-red bg-rag-red-bg',
  none: 'text-rag-none bg-rag-none-bg',
};

/** RAG icons distinguish by shape as well as colour: circle on track,
 *  triangle at risk, diamond off track, dash for no data. */
const icons: Record<Rag, string> = {
  green: '●',
  amber: '▲',
  red: '◆',
  none: '–',
};

export function RagBadge({
  rag,
  label,
  className,
}: {
  rag: Rag;
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap',
        styles[rag],
        className,
      )}
    >
      <span aria-hidden="true" className="text-[0.6rem] leading-none">
        {icons[rag]}
      </span>
      {label ?? ragLabel(rag)}
    </span>
  );
}
