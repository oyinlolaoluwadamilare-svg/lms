import {
  createKeyResult,
  createObjective,
  deleteKeyResult,
  deleteObjective,
  updateObjective,
} from '@/actions/admin';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { Input, Label, Select } from '@/components/ui/input';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import type { Dataset, Objective } from '@/lib/types';

function ObjectiveRow({ ds, objective }: { ds: Dataset; objective: Objective }) {
  const kpiCount = ds.kpis.filter((k) => k.objectiveId === objective.id).length;
  const groupObjectives = ds.objectives.filter((o) => o.kind === 'group');
  const krs = ds.keyResults.filter((kr) => kr.objectiveId === objective.id);
  return (
    <div className="border-b border-line pb-3 last:border-0 space-y-2">
      <form action={updateObjective} className="grid gap-2 lg:grid-cols-12 items-end">
        <input type="hidden" name="id" value={objective.id} />
        <div className="lg:col-span-4">
          <Label htmlFor={`obj-title-${objective.id}`}>Title</Label>
          <Input id={`obj-title-${objective.id}`} name="title" defaultValue={objective.title} required />
        </div>
        <div className="lg:col-span-2">
          <Label htmlFor={`obj-persp-${objective.id}`}>Perspective</Label>
          <Select
            id={`obj-persp-${objective.id}`}
            name="perspectiveId"
            defaultValue={objective.perspectiveId ?? ''}
          >
            <option value="">None</option>
            {ds.perspectives.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        {objective.kind === 'unit' && (
          <div className="lg:col-span-3">
            <Label htmlFor={`obj-parent-${objective.id}`}>Group objective</Label>
            <Select
              id={`obj-parent-${objective.id}`}
              name="parentId"
              defaultValue={objective.parentId ?? ''}
            >
              <option value="">None</option>
              {groupObjectives.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div>
          <Label htmlFor={`obj-fw-${objective.id}`}>Framework</Label>
          <Select id={`obj-fw-${objective.id}`} name="framework" defaultValue={objective.framework}>
            <option value="MBO">MBO</option>
            <option value="OKR">OKR</option>
          </Select>
        </div>
        <div>
          <Label htmlFor={`obj-w-${objective.id}`}>Weight</Label>
          <Input
            id={`obj-w-${objective.id}`}
            name="weight"
            type="number"
            step="0.1"
            min="0"
            defaultValue={objective.weight}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Button type="submit" variant="secondary" size="sm">
            Save
          </Button>
        </div>
      </form>
      <div className="flex items-center justify-between">
        <span className="text-xs text-charcoal/50">{kpiCount} KPIs measure this objective</span>
        <form action={deleteObjective}>
          <input type="hidden" name="id" value={objective.id} />
          <ConfirmButton
            message={`Delete the objective "${objective.title}"?`}
            variant="ghost"
            size="sm"
            disabled={kpiCount > 0}
          >
            Delete
          </ConfirmButton>
        </form>
      </div>
      {objective.framework === 'OKR' && (
        <div className="pl-3 border-l-2 border-line space-y-1.5">
          {krs.map((kr) => (
            <div key={kr.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-charcoal/80">
                {kr.title}
                {kr.targetText ? ` (target: ${kr.targetText})` : ''}
              </span>
              <form action={deleteKeyResult}>
                <input type="hidden" name="id" value={kr.id} />
                <Button type="submit" variant="ghost" size="sm">
                  Remove
                </Button>
              </form>
            </div>
          ))}
          <form action={createKeyResult} className="flex items-center gap-2">
            <input type="hidden" name="objectiveId" value={objective.id} />
            <Input name="title" required placeholder="Add a key result" className="max-w-xs" aria-label="Key result title" />
            <Input name="targetText" placeholder="Target" className="max-w-32" aria-label="Key result target" />
            <Button type="submit" variant="secondary" size="sm">
              Add
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}

export function ObjectivesTab({ ds, year }: { ds: Dataset; year: number }) {
  const groupObjectives = ds.objectives.filter((o) => o.kind === 'group');
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Group objectives</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          {groupObjectives.map((o) => (
            <ObjectiveRow key={o.id} ds={ds} objective={o} />
          ))}
          <form action={createObjective} className="grid gap-2 lg:grid-cols-6 items-end pt-2 border-t border-line">
            <input type="hidden" name="year" value={year} />
            <input type="hidden" name="kind" value="group" />
            <div className="lg:col-span-3">
              <Label htmlFor="new-gobj-title">New group objective</Label>
              <Input id="new-gobj-title" name="title" required placeholder="Grow group revenue to N1.5bn" />
            </div>
            <div>
              <Label htmlFor="new-gobj-persp">Perspective</Label>
              <Select id="new-gobj-persp" name="perspectiveId" defaultValue="">
                <option value="">None</option>
                {ds.perspectives.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="new-gobj-w">Weight</Label>
              <Input id="new-gobj-w" name="weight" type="number" step="0.1" min="0" defaultValue="1" />
            </div>
            <Button type="submit">Add</Button>
          </form>
        </CardBody>
      </Card>

      {ds.units
        .filter((u) => u.active)
        .map((unit) => {
          const unitObjectives = ds.objectives.filter((o) => o.unitId === unit.id);
          return (
            <Card key={unit.id}>
              <CardHeader>
                <CardTitle>{unit.name}</CardTitle>
              </CardHeader>
              <CardBody className="space-y-3">
                {unitObjectives.map((o) => (
                  <ObjectiveRow key={o.id} ds={ds} objective={o} />
                ))}
                <form
                  action={createObjective}
                  className="grid gap-2 lg:grid-cols-7 items-end pt-2 border-t border-line"
                >
                  <input type="hidden" name="year" value={year} />
                  <input type="hidden" name="kind" value="unit" />
                  <input type="hidden" name="unitId" value={unit.id} />
                  <div className="lg:col-span-2">
                    <Label htmlFor={`new-obj-title-${unit.id}`}>New unit objective</Label>
                    <Input id={`new-obj-title-${unit.id}`} name="title" required />
                  </div>
                  <div className="lg:col-span-2">
                    <Label htmlFor={`new-obj-parent-${unit.id}`}>Under group objective</Label>
                    <Select id={`new-obj-parent-${unit.id}`} name="parentId" defaultValue="">
                      <option value="">None</option>
                      {groupObjectives.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.title}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor={`new-obj-persp-${unit.id}`}>Perspective</Label>
                    <Select id={`new-obj-persp-${unit.id}`} name="perspectiveId" defaultValue="">
                      <option value="">None</option>
                      {ds.perspectives.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor={`new-obj-fw-${unit.id}`}>Framework</Label>
                    <Select id={`new-obj-fw-${unit.id}`} name="framework" defaultValue="MBO">
                      <option value="MBO">MBO</option>
                      <option value="OKR">OKR</option>
                    </Select>
                  </div>
                  <Button type="submit">Add</Button>
                </form>
              </CardBody>
            </Card>
          );
        })}
    </div>
  );
}
