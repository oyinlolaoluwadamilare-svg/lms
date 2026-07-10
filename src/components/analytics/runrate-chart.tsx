'use client';

import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { RAG_COLORS } from '@/lib/palette';

export interface RunRateRow {
  name: string;
  projectedAttainment: number | null;
  rag: string;
  detail: string;
}

/** Year-end projection per KPI at the current run rate, against the
 *  100% target line. */
export function RunRateChart({ rows }: { rows: RunRateRow[] }) {
  const data = rows.map((r) => ({ ...r, projectedAttainment: r.projectedAttainment ?? 0 }));
  const height = Math.max(180, rows.length * 42 + 40);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 40, bottom: 4, left: 8 }}>
        <XAxis
          type="number"
          domain={[0, 150]}
          unit="%"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 12 }}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={190}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 12 }}
        />
        <Tooltip
          formatter={(value: number | string, _key, item) => {
            const row = item?.payload as RunRateRow | undefined;
            return [row ? `${Math.round(Number(value))}%. ${row.detail}` : `${value}%`, 'Projected'];
          }}
          contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: 'var(--color-line)' }}
        />
        <ReferenceLine x={100} stroke="#475569" strokeDasharray="4 4" />
        <Bar dataKey="projectedAttainment" radius={[0, 4, 4, 0]} barSize={16}>
          {data.map((row) => (
            <Cell key={row.name} fill={RAG_COLORS[row.rag] ?? RAG_COLORS.none} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
