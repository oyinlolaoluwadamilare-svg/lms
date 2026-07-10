'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { seriesColor } from '@/lib/palette';

export interface TrendPoint {
  month: string;
  [series: string]: string | number | null;
}

/** Unit scores month by month across the year. */
export function TrendChart({ data, series }: { data: TrendPoint[]; series: string[] }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="var(--color-line)" vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
        <YAxis
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 12 }}
          unit="%"
          width={44}
          domain={[0, 150]}
        />
        <Tooltip
          formatter={(value: number | string) => [`${Math.round(Number(value))}%`]}
          contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: 'var(--color-line)' }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <ReferenceLine y={100} stroke="#94A3B8" strokeDasharray="4 4" />
        {series.map((name, i) => (
          <Line
            key={name}
            type="monotone"
            dataKey={name}
            stroke={seriesColor(i)}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
