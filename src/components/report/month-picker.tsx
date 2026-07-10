'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { MONTHS } from '@/lib/format';

export function MonthPicker({ month }: { month: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <select
      aria-label="Entry month"
      className="rounded-lg border border-line bg-white px-2 py-1.5 text-sm font-semibold"
      value={month}
      onChange={(e) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('m', e.target.value);
        router.push(`${pathname}?${params.toString()}`);
      }}
    >
      {MONTHS.map((m, i) => (
        <option key={m} value={i + 1}>
          {m}
        </option>
      ))}
    </select>
  );
}
