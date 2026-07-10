'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/cn';
import { MONTHS, periodToParam } from '@/lib/format';
import type { Period } from '@/lib/types';

const QUICK: { label: string; param: string }[] = [
  { label: 'FY', param: 'year' },
  { label: 'H1', param: 'h1' },
  { label: 'H2', param: 'h2' },
  { label: 'Q1', param: 'q1' },
  { label: 'Q2', param: 'q2' },
  { label: 'Q3', param: 'q3' },
  { label: 'Q4', param: 'q4' },
];

/** Switch year, half, quarter, and month. Selection lives in the URL so
 *  server components recompute and links stay shareable. */
export function PeriodBar({
  years,
  year,
  period,
}: {
  years: number[];
  year: number;
  period: Period;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = periodToParam(period);

  function navigate(next: { year?: number; period?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.year) params.set('year', String(next.year));
    if (next.period) params.set('period', next.period);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Reporting period">
      {years.length > 1 && (
        <select
          aria-label="Fiscal year"
          className="rounded-lg border border-line bg-white px-2 py-1.5 text-sm font-semibold"
          value={year}
          onChange={(e) => navigate({ year: Number(e.target.value) })}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              FY {y}
            </option>
          ))}
        </select>
      )}
      {years.length === 1 && (
        <span className="text-sm font-bold text-charcoal/70 pr-1">FY {year}</span>
      )}
      <div className="flex rounded-lg border border-line bg-white overflow-hidden">
        {QUICK.map((q) => (
          <button
            key={q.param}
            type="button"
            aria-pressed={current === q.param}
            onClick={() => navigate({ period: q.param })}
            className={cn(
              'px-2.5 py-1.5 text-sm font-semibold border-r border-line last:border-r-0 cursor-pointer',
              current === q.param ? 'bg-navy text-white' : 'text-charcoal/70 hover:bg-surface',
            )}
          >
            {q.label}
          </button>
        ))}
      </div>
      <select
        aria-label="Month"
        className="rounded-lg border border-line bg-white px-2 py-1.5 text-sm font-semibold"
        value={period.kind === 'month' ? `m${period.index}` : ''}
        onChange={(e) => e.target.value && navigate({ period: e.target.value })}
      >
        <option value="">Month…</option>
        {MONTHS.map((m, i) => (
          <option key={m} value={`m${i + 1}`}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
}
