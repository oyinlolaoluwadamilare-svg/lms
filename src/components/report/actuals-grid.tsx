'use client';

import { useMemo, useState, useTransition } from 'react';
import { attainment, ragFor } from '@/lib/engine';
import { formatAttainment, formatValue, monthName } from '@/lib/format';
import { RagBadge } from '@/components/rag-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { saveMonthlyActuals } from '@/actions/actuals';
import type { Direction } from '@/lib/types';

export interface ActualsRow {
  kpiId: string;
  name: string;
  uom: string;
  direction: Direction;
  oneOff: boolean;
  target: number | null;
  value: number | null;
  note: string | null;
}

/** Keyboard-first monthly entry. Attainment and RAG update live as the
 *  operator types; nothing is written until Save. */
export function ActualsGrid({
  rows,
  month,
  year,
  unitId,
}: {
  rows: ActualsRow[];
  month: number;
  year: number;
  unitId: string;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.kpiId, r.value === null ? '' : String(r.value)])),
  );
  const [notes, setNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.kpiId, r.note ?? ''])),
  );
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const live = useMemo(
    () =>
      rows.map((r) => {
        const raw = values[r.kpiId]?.trim() ?? '';
        const value = raw === '' ? null : Number(raw);
        const valid = value === null || Number.isFinite(value);
        const att = valid ? attainment(value, r.target, r.direction) : null;
        return { ...r, entered: value, valid, attainment: att, rag: ragFor(att) };
      }),
    [rows, values],
  );

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      try {
        await saveMonthlyActuals(formData);
        setSavedAt(new Date().toLocaleTimeString());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Save failed. Please try again.');
      }
    });
  }

  return (
    <form onSubmit={onSubmit}>
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="unit" value={unitId} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left">
              <th className="py-2 px-3 text-xs font-bold uppercase tracking-wide text-charcoal/60">
                KPI
              </th>
              <th className="py-2 px-3 text-xs font-bold uppercase tracking-wide text-charcoal/60 text-right">
                {monthName(month)} target
              </th>
              <th className="py-2 px-3 text-xs font-bold uppercase tracking-wide text-charcoal/60 w-36">
                Actual
              </th>
              <th className="py-2 px-3 text-xs font-bold uppercase tracking-wide text-charcoal/60 text-right">
                Attainment
              </th>
              <th className="py-2 px-3 text-xs font-bold uppercase tracking-wide text-charcoal/60">
                Status
              </th>
              <th className="py-2 px-3 text-xs font-bold uppercase tracking-wide text-charcoal/60">
                Note (optional)
              </th>
            </tr>
          </thead>
          <tbody>
            {live.map((r) => (
              <tr key={r.kpiId} className="border-b border-line last:border-0">
                <td className="py-2 px-3">
                  <p className="font-semibold text-charcoal">{r.name}</p>
                  <p className="text-xs text-charcoal/50">
                    {r.uom}
                    {r.direction === 'lower' ? ', lower is better' : ''}
                    {r.oneOff ? ', one-off' : ''}
                  </p>
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-charcoal/70">
                  {formatValue(r.target, r.uom)}
                </td>
                <td className="py-2 px-3">
                  <Input
                    name={`value-${r.kpiId}`}
                    inputMode="decimal"
                    autoComplete="off"
                    aria-label={`${r.name} actual for ${monthName(month)}`}
                    aria-invalid={!r.valid}
                    value={values[r.kpiId] ?? ''}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [r.kpiId]: e.target.value }))
                    }
                    className={r.valid ? '' : 'border-rag-red'}
                  />
                </td>
                <td className="py-2 px-3 text-right tabular-nums font-semibold">
                  {r.valid ? formatAttainment(r.attainment) : 'Not a number'}
                </td>
                <td className="py-2 px-3">
                  <RagBadge rag={r.rag} />
                </td>
                <td className="py-2 px-3">
                  <Input
                    name={`note-${r.kpiId}`}
                    aria-label={`${r.name} note`}
                    value={notes[r.kpiId] ?? ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [r.kpiId]: e.target.value }))}
                    placeholder="Context for this number"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 px-3 py-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : `Save ${monthName(month)} actuals`}
        </Button>
        {savedAt && !pending && (
          <span className="text-sm text-rag-green font-semibold">Saved at {savedAt}</span>
        )}
        {error && (
          <span role="alert" className="text-sm text-rag-red font-semibold">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
