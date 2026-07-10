import { createUnit, saveAspiration, updateUnit } from '@/actions/admin';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import type { Dataset } from '@/lib/types';

export function UnitsTab({ ds, year }: { ds: Dataset; year: number }) {
  return (
    <div className="space-y-4">
      {ds.units.map((unit) => {
        const aspiration = ds.aspirations.find((a) => a.unitId === unit.id);
        return (
          <Card key={unit.id}>
            <CardHeader className="flex items-baseline justify-between gap-2">
              <CardTitle>{unit.name}</CardTitle>
              <span className="text-xs text-charcoal/50 font-semibold">{unit.slug}@wfg.demo</span>
            </CardHeader>
            <CardBody className="space-y-3">
              <form
                action={updateUnit}
                className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 items-end"
              >
                <input type="hidden" name="id" value={unit.id} />
                <div className="lg:col-span-2">
                  <Label htmlFor={`unit-name-${unit.id}`}>Name</Label>
                  <Input id={`unit-name-${unit.id}`} name="name" defaultValue={unit.name} required />
                </div>
                <div>
                  <Label htmlFor={`unit-type-${unit.id}`}>Type</Label>
                  <Select id={`unit-type-${unit.id}`} name="type" defaultValue={unit.type}>
                    <option value="LOB">LOB</option>
                    <option value="AOB">AOB</option>
                    <option value="Unit">Unit</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor={`unit-weight-${unit.id}`}>Weight</Label>
                  <Input
                    id={`unit-weight-${unit.id}`}
                    name="weight"
                    type="number"
                    step="0.1"
                    min="0"
                    defaultValue={unit.weight}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-sm font-semibold text-charcoal">
                    <input type="checkbox" name="active" defaultChecked={unit.active} />
                    Active
                  </label>
                  <Button type="submit" variant="secondary" size="sm">
                    Save
                  </Button>
                </div>
              </form>
              <form action={saveAspiration} className="flex gap-2 items-start">
                <input type="hidden" name="unitId" value={unit.id} />
                <input type="hidden" name="year" value={year} />
                <div className="flex-1">
                  <Label htmlFor={`asp-${unit.id}`}>Winning aspiration for {year}</Label>
                  <Textarea
                    id={`asp-${unit.id}`}
                    name="text"
                    defaultValue={aspiration?.text ?? ''}
                    className="min-h-16"
                    placeholder="The one-line bold statement of what this unit is trying to become."
                  />
                </div>
                <Button type="submit" variant="secondary" size="sm" className="mt-6">
                  Save
                </Button>
              </form>
            </CardBody>
          </Card>
        );
      })}

      <Card>
        <CardHeader>
          <CardTitle>Add a unit</CardTitle>
        </CardHeader>
        <CardBody>
          <form action={createUnit} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6 items-end">
            <div className="lg:col-span-2">
              <Label htmlFor="new-unit-name">Name</Label>
              <Input id="new-unit-name" name="name" required placeholder="Workforce Digital" />
            </div>
            <div>
              <Label htmlFor="new-unit-slug">Slug</Label>
              <Input id="new-unit-slug" name="slug" required placeholder="digital" />
            </div>
            <div>
              <Label htmlFor="new-unit-type">Type</Label>
              <Select id="new-unit-type" name="type" defaultValue="LOB">
                <option value="LOB">LOB</option>
                <option value="AOB">AOB</option>
                <option value="Unit">Unit</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="new-unit-weight">Weight</Label>
              <Input id="new-unit-weight" name="weight" type="number" step="0.1" min="0" defaultValue="1" />
            </div>
            <Button type="submit">Create unit and login</Button>
            <div className="lg:col-span-3">
              <Label htmlFor="new-unit-email">Operator email (optional)</Label>
              <Input id="new-unit-email" name="email" type="email" placeholder="Defaults to slug@wfg.demo" />
            </div>
            <div className="lg:col-span-3">
              <Label htmlFor="new-unit-password">Operator password (optional)</Label>
              <Input id="new-unit-password" name="password" type="text" placeholder="Defaults to wfg2026" />
            </div>
          </form>
          <p className="text-xs text-charcoal/50 mt-2">
            Creating a unit also creates its operator login, scoped to this unit only.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
