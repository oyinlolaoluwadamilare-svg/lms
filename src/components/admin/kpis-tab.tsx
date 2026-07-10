import { createKpi, deleteKpi, updateKpi } from '@/actions/admin';
import { AiPanel } from '@/components/ai/ai-panel';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { Input, Label, Select } from '@/components/ui/input';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import type { Dataset, Kpi } from '@/lib/types';

function KpiFields({
  ds,
  unitId,
  kpi,
  idPrefix,
}: {
  ds: Dataset;
  unitId: string;
  kpi?: Kpi;
  idPrefix: string;
}) {
  const unitObjectives = ds.objectives.filter((o) => o.unitId === unitId);
  return (
    <>
      <div className="lg:col-span-3">
        <Label htmlFor={`${idPrefix}-name`}>Name</Label>
        <Input id={`${idPrefix}-name`} name="name" defaultValue={kpi?.name} required />
      </div>
      <div className="lg:col-span-2">
        <Label htmlFor={`${idPrefix}-obj`}>Objective</Label>
        <Select id={`${idPrefix}-obj`} name="objectiveId" defaultValue={kpi?.objectiveId ?? ''} required>
          {!kpi && <option value="">Choose…</option>}
          {unitObjectives.map((o) => (
            <option key={o.id} value={o.id}>
              {o.title}
            </option>
          ))}
        </Select>
      </div>
      <div className="lg:col-span-2">
        <Label htmlFor={`${idPrefix}-persp`}>Perspective</Label>
        <Select id={`${idPrefix}-persp`} name="perspectiveId" defaultValue={kpi?.perspectiveId ?? ''} required>
          {!kpi && <option value="">Choose…</option>}
          {ds.perspectives.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-uom`}>Unit of measure</Label>
        <Input id={`${idPrefix}-uom`} name="uom" defaultValue={kpi?.uom} required placeholder="NGN m, %, days, count" />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-dir`}>Direction</Label>
        <Select id={`${idPrefix}-dir`} name="direction" defaultValue={kpi?.direction ?? 'higher'}>
          <option value="higher">Higher is better</option>
          <option value="lower">Lower is better</option>
        </Select>
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-agg`}>Aggregation</Label>
        <Select id={`${idPrefix}-agg`} name="aggregation" defaultValue={kpi?.aggregation ?? 'sum'}>
          <option value="sum">Sum (flows: revenue, placements)</option>
          <option value="average">Average (rates: never sum a rate)</option>
          <option value="end">Period end (stocks: headcount)</option>
        </Select>
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-cad`}>Cadence</Label>
        <Select id={`${idPrefix}-cad`} name="cadence" defaultValue={kpi?.cadence ?? 'continuous'}>
          <option value="continuous">Continuous (monthly)</option>
          <option value="one_off">One-off deliverable</option>
        </Select>
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-w`}>Weight</Label>
        <Input id={`${idPrefix}-w`} name="weight" type="number" step="0.1" min="0" defaultValue={kpi?.weight ?? 1} />
      </div>
    </>
  );
}

export function KpisTab({
  ds,
  year,
  unitParam,
}: {
  ds: Dataset;
  year: number;
  unitParam?: string;
}) {
  const activeUnits = ds.units.filter((u) => u.active);
  const unit = activeUnits.find((u) => u.id === unitParam) ?? activeUnits[0];
  if (!unit) return <p className="text-sm text-charcoal/60">Create a unit first.</p>;
  const unitKpis = ds.kpis.filter((k) => k.unitId === unit.id);

  return (
    <div className="space-y-4">
      <form method="get" className="flex items-center gap-2">
        <input type="hidden" name="tab" value="kpis" />
        <Label htmlFor="kpi-unit" className="mb-0">
          Unit
        </Label>
        <Select id="kpi-unit" name="unit" defaultValue={unit.id} className="w-64">
          {activeUnits.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary" size="sm">
          Open
        </Button>
      </form>

      {unitKpis.map((kpi) => (
        <Card key={kpi.id}>
          <CardBody className="pt-4 space-y-2">
            <form action={updateKpi} className="grid gap-2 lg:grid-cols-12 items-end">
              <input type="hidden" name="id" value={kpi.id} />
              <KpiFields ds={ds} unitId={unit.id} kpi={kpi} idPrefix={`kpi-${kpi.id}`} />
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-sm font-semibold text-charcoal">
                  <input type="checkbox" name="active" defaultChecked={kpi.active} />
                  Active
                </label>
                <Button type="submit" variant="secondary" size="sm">
                  Save
                </Button>
              </div>
            </form>
            <div className="flex justify-end">
              <form action={deleteKpi}>
                <input type="hidden" name="id" value={kpi.id} />
                <ConfirmButton
                  message={`Delete the KPI "${kpi.name}" and all its targets and actuals?`}
                  variant="ghost"
                  size="sm"
                >
                  Delete
                </ConfirmButton>
              </form>
            </div>
          </CardBody>
        </Card>
      ))}

      <AiPanel
        title="Suggest KPIs"
        description={`Proposes measurable KPIs for ${unit.name} from its objectives, perspectives, and aspiration. Review, then create the ones you adopt below.`}
        endpoint="/api/ai/suggest-kpis"
        payload={{ unitId: unit.id, year }}
        buttonLabel="Suggest KPIs"
      />

      <Card>
        <CardHeader>
          <CardTitle>Add a KPI to {unit.name}</CardTitle>
        </CardHeader>
        <CardBody>
          <form action={createKpi} className="grid gap-2 lg:grid-cols-12 items-end">
            <input type="hidden" name="year" value={year} />
            <input type="hidden" name="unitId" value={unit.id} />
            <KpiFields ds={ds} unitId={unit.id} idPrefix="new-kpi" />
            <Button type="submit">Add KPI</Button>
          </form>
          <p className="text-xs text-charcoal/50 mt-2">
            Set the target in the targets editor after creating the KPI. One-off deliverables are
            always scored at period end on achievement.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
