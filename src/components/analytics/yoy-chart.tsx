'use client';

import {
  Bar,
  BarChart,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { seriesColor } from '@/lib/palette';

export interface YoyRow {
  name: string;
  [year: string]: string | number | null;
}

/** Unit scores this year against last, when a prior year exists. */
export function YoyChart({ rows, years }: { rows: YoyRow[]; years: string[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
        <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} interval={0} />
        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12 }} unit="%" width={44} domain={[0, 150]} />
        <Tooltip
          formatter={(value) => [`${Math.round(Number(value ?? 0))}%`]}
          contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: 'var(--color-line)' }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <ReferenceLine y={100} stroke="#94A3B8" strokeDasharray="4 4" />
        {years.map((year, i) => (
          <Bar key={year} dataKey={year} fill={seriesColor(i)} radius={[4, 4, 0, 0]} barSize={18} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
