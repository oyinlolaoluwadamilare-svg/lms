'use client';

import {
  Bar,
  BarChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { RAG_COLORS } from '@/lib/palette';

export interface RagRow {
  name: string;
  'On track': number;
  'At risk': number;
  'Off track': number;
  'No data': number;
}

const KEYS = [
  { key: 'On track' as const, color: RAG_COLORS.green },
  { key: 'At risk' as const, color: RAG_COLORS.amber },
  { key: 'Off track' as const, color: RAG_COLORS.red },
  { key: 'No data' as const, color: RAG_COLORS.none },
];

/** How each unit's KPIs split across RAG states for the period. */
export function RagDistribution({ rows }: { rows: RagRow[] }) {
  const height = Math.max(160, rows.length * 40 + 60);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
        <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
        <YAxis
          type="category"
          dataKey="name"
          width={170}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 12 }}
        />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: 'var(--color-line)' }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {KEYS.map(({ key, color }) => (
          <Bar key={key} dataKey={key} stackId="rag" fill={color} stroke="#ffffff" strokeWidth={2} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
