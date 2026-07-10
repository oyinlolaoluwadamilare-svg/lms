import { createPerspective, deletePerspective, updatePerspective } from '@/actions/admin';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { Input, Label } from '@/components/ui/input';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import type { Dataset } from '@/lib/types';

export function PerspectivesTab({ ds }: { ds: Dataset }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Balanced scorecard perspectives</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm text-charcoal/60">
          The lenses KPIs sit under. A perspective in use by KPIs cannot be deleted.
        </p>
        <ul className="space-y-2">
          {ds.perspectives.map((p) => {
            const inUse = ds.kpis.filter((k) => k.perspectiveId === p.id).length;
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-2">
                <form action={updatePerspective} className="flex items-center gap-2 flex-1 min-w-64">
                  <input type="hidden" name="id" value={p.id} />
                  <Input name="name" defaultValue={p.name} aria-label={`Rename ${p.name}`} />
                  <Button type="submit" variant="secondary" size="sm">
                    Rename
                  </Button>
                </form>
                <span className="text-xs text-charcoal/50 w-20">{inUse} KPIs</span>
                <form action={deletePerspective}>
                  <input type="hidden" name="id" value={p.id} />
                  <ConfirmButton
                    message={`Delete the perspective "${p.name}"?`}
                    variant="ghost"
                    size="sm"
                    disabled={inUse > 0}
                  >
                    Delete
                  </ConfirmButton>
                </form>
              </li>
            );
          })}
        </ul>
        <form action={createPerspective} className="flex items-end gap-2 pt-2 border-t border-line">
          <div className="flex-1 max-w-sm">
            <Label htmlFor="new-perspective">Add a perspective</Label>
            <Input id="new-perspective" name="name" required placeholder="Sustainability" />
          </div>
          <Button type="submit">Add</Button>
        </form>
      </CardBody>
    </Card>
  );
}
