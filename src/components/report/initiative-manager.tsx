import { createInitiative, deleteInitiative, updateInitiativeStatus } from '@/actions/actuals';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { formatDate } from '@/lib/format';
import type { Initiative, Kpi } from '@/lib/types';

const STATUSES = [
  { value: 'not_started', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
  { value: 'blocked', label: 'Blocked' },
];

export function InitiativeManager({
  initiatives,
  kpis,
  unitId,
  year,
}: {
  initiatives: Initiative[];
  kpis: Kpi[];
  unitId: string;
  year: number;
}) {
  return (
    <div className="space-y-4">
      {initiatives.length > 0 && (
        <ul className="space-y-3">
          {initiatives.map((init) => {
            const kpi = kpis.find((k) => k.id === init.kpiId);
            return (
              <li
                key={init.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-charcoal text-sm">{init.title}</p>
                  <p className="text-xs text-charcoal/60">
                    {kpi ? `KPI: ${kpi.name}. ` : ''}Owner: {init.owner}
                    {init.dueDate ? `. Due ${formatDate(init.dueDate)}` : ''}
                  </p>
                  {init.note && <p className="text-xs text-charcoal/70 mt-1">{init.note}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <form action={updateInitiativeStatus} className="flex items-center gap-1.5">
                    <input type="hidden" name="id" value={init.id} />
                    <Select
                      name="status"
                      defaultValue={init.status}
                      aria-label={`Status of ${init.title}`}
                      className="w-36 py-1.5"
                    >
                      {STATUSES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </Select>
                    <Button type="submit" variant="secondary" size="sm">
                      Update
                    </Button>
                  </form>
                  <form action={deleteInitiative}>
                    <input type="hidden" name="id" value={init.id} />
                    <Button type="submit" variant="ghost" size="sm" aria-label={`Delete ${init.title}`}>
                      Delete
                    </Button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form action={createInitiative} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6 items-end">
        <input type="hidden" name="year" value={year} />
        <input type="hidden" name="unit" value={unitId} />
        <div className="lg:col-span-2">
          <label className="block text-xs font-bold text-charcoal/60 mb-1" htmlFor="init-title">
            New initiative
          </label>
          <Input id="init-title" name="title" required placeholder="What will you do?" />
        </div>
        <div>
          <label className="block text-xs font-bold text-charcoal/60 mb-1" htmlFor="init-owner">
            Owner
          </label>
          <Input id="init-owner" name="owner" required placeholder="Who owns it?" />
        </div>
        <div>
          <label className="block text-xs font-bold text-charcoal/60 mb-1" htmlFor="init-kpi">
            KPI
          </label>
          <Select id="init-kpi" name="kpiId" defaultValue="">
            <option value="">Not linked</option>
            {kpis.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="block text-xs font-bold text-charcoal/60 mb-1" htmlFor="init-due">
            Due date
          </label>
          <Input id="init-due" name="dueDate" type="date" />
        </div>
        <Button type="submit" variant="secondary">
          Add initiative
        </Button>
      </form>
    </div>
  );
}
