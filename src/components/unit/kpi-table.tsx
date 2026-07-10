import { RagBadge } from '@/components/rag-badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatAttainment, formatValue } from '@/lib/format';
import type { Dataset, Kpi, KpiResult, Period } from '@/lib/types';
import { monthsInPeriod } from '@/lib/engine';

export function KpiTable({
  ds,
  kpis,
  results,
  period,
}: {
  ds: Dataset;
  kpis: Kpi[];
  results: Map<string, KpiResult>;
  period: Period;
}) {
  const periodMonths = monthsInPeriod(period).length;
  return (
    <Table>
      <THead>
        <TR>
          <TH>KPI</TH>
          <TH>Perspective</TH>
          <TH className="text-right">Target</TH>
          <TH className="text-right">Actual</TH>
          <TH className="text-right">Attainment</TH>
          <TH>Status</TH>
          <TH className="text-right">Reported</TH>
        </TR>
      </THead>
      <TBody>
        {kpis.map((kpi) => {
          const r = results.get(kpi.id);
          const perspective = ds.perspectives.find((p) => p.id === kpi.perspectiveId);
          return (
            <TR key={kpi.id}>
              <TD>
                <p className="font-semibold text-charcoal">{kpi.name}</p>
                <p className="text-xs text-charcoal/50">
                  {kpi.uom}
                  {kpi.direction === 'lower' ? ', lower is better' : ''}
                  {kpi.cadence === 'one_off' ? ', one-off deliverable' : ''}
                </p>
              </TD>
              <TD className="text-charcoal/70">{perspective?.name ?? ''}</TD>
              <TD className="text-right tabular-nums">{formatValue(r?.target ?? null, kpi.uom)}</TD>
              <TD className="text-right tabular-nums font-semibold">
                {formatValue(r?.actual ?? null, kpi.uom)}
              </TD>
              <TD className="text-right tabular-nums font-semibold">
                {formatAttainment(r?.attainment ?? null)}
              </TD>
              <TD>
                <RagBadge rag={r?.rag ?? 'none'} />
              </TD>
              <TD className="text-right text-charcoal/60 tabular-nums">
                {kpi.cadence === 'one_off'
                  ? (r?.actual ?? null) !== null
                    ? 'Done'
                    : 'Open'
                  : `${r?.monthsReported ?? 0}/${periodMonths}`}
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}
