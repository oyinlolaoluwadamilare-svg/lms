'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { initiatives, kpis, monthlyActuals } from '@/db/schema';
import { getFiscalYearId } from '@/lib/fiscal';
import { resolveActingUnit } from '@/lib/session';
import { writeAudit } from '@/lib/audit';

/** Save a month of actuals for a unit. Field names: value-<kpiId>, note-<kpiId>.
 *  Empty values clear the entry (not reported), never write zero. */
export async function saveMonthlyActuals(formData: FormData) {
  const year = Number(formData.get('year'));
  const month = Number(formData.get('month'));
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('Choose a valid month.');
  }
  const { user, unitId } = await resolveActingUnit(formData.get('unit')?.toString());
  const fiscalYearId = await getFiscalYearId(year);

  // Only KPIs that belong to this unit and year may be written.
  const unitKpis = await db
    .select({ id: kpis.id })
    .from(kpis)
    .where(and(eq(kpis.unitId, unitId), eq(kpis.fiscalYearId, fiscalYearId)));
  const allowed = new Set(unitKpis.map((k) => k.id));

  let saved = 0;
  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith('value-')) continue;
    const kpiId = key.slice('value-'.length);
    if (!allowed.has(kpiId)) continue;
    const valueText = raw.toString().trim();
    const noteText = formData.get(`note-${kpiId}`)?.toString().trim() ?? '';
    const value = valueText === '' ? null : Number(valueText);
    if (value !== null && !Number.isFinite(value)) {
      throw new Error(`"${valueText}" is not a number.`);
    }
    await db
      .insert(monthlyActuals)
      .values({
        kpiId,
        fiscalYearId,
        month,
        value: value === null ? null : String(value),
        note: noteText === '' ? null : noteText,
        enteredBy: user.userId,
      })
      .onConflictDoUpdate({
        target: [monthlyActuals.kpiId, monthlyActuals.fiscalYearId, monthlyActuals.month],
        set: {
          value: value === null ? null : String(value),
          note: noteText === '' ? null : noteText,
          enteredBy: user.userId,
          updatedAt: new Date(),
        },
      });
    saved++;
  }

  await writeAudit(user, 'actuals.save', 'monthly_actuals', unitId, { year, month, saved });
  revalidatePath('/report');
  revalidatePath('/dashboard');
  revalidatePath(`/units/${unitId}`);
}

export async function createInitiative(formData: FormData) {
  const year = Number(formData.get('year'));
  const { user, unitId } = await resolveActingUnit(formData.get('unit')?.toString());
  const fiscalYearId = await getFiscalYearId(year);
  const title = formData.get('title')?.toString().trim();
  const owner = formData.get('owner')?.toString().trim();
  if (!title || !owner) throw new Error('An initiative needs a title and an owner.');
  const kpiId = formData.get('kpiId')?.toString() || null;
  if (kpiId) {
    const [kpi] = await db.select({ unitId: kpis.unitId }).from(kpis).where(eq(kpis.id, kpiId));
    if (!kpi || kpi.unitId !== unitId) throw new Error('That KPI does not belong to this unit.');
  }
  const dueDate = formData.get('dueDate')?.toString() || null;
  const [row] = await db
    .insert(initiatives)
    .values({
      unitId,
      fiscalYearId,
      kpiId,
      title,
      owner,
      dueDate,
      note: formData.get('note')?.toString().trim() || null,
    })
    .returning();
  await writeAudit(user, 'initiative.create', 'initiatives', row.id, { title });
  revalidatePath('/report');
  revalidatePath(`/units/${unitId}`);
}

export async function updateInitiativeStatus(formData: FormData) {
  const id = formData.get('id')?.toString();
  const status = formData.get('status')?.toString() as
    | 'not_started'
    | 'in_progress'
    | 'done'
    | 'blocked';
  if (!id || !['not_started', 'in_progress', 'done', 'blocked'].includes(status)) {
    throw new Error('Invalid initiative update.');
  }
  const [row] = await db.select().from(initiatives).where(eq(initiatives.id, id));
  if (!row) throw new Error('Initiative not found.');
  const { user, unitId } = await resolveActingUnit(row.unitId);
  if (row.unitId !== unitId) throw new Error('You do not have access to this initiative.');
  await db.update(initiatives).set({ status, updatedAt: new Date() }).where(eq(initiatives.id, id));
  await writeAudit(user, 'initiative.status', 'initiatives', id, { status });
  revalidatePath('/report');
  revalidatePath(`/units/${unitId}`);
}

export async function deleteInitiative(formData: FormData) {
  const id = formData.get('id')?.toString();
  if (!id) throw new Error('Missing initiative.');
  const [row] = await db.select().from(initiatives).where(eq(initiatives.id, id));
  if (!row) return;
  const { user, unitId } = await resolveActingUnit(row.unitId);
  if (row.unitId !== unitId) throw new Error('You do not have access to this initiative.');
  await db.delete(initiatives).where(eq(initiatives.id, id));
  await writeAudit(user, 'initiative.delete', 'initiatives', id, { title: row.title });
  revalidatePath('/report');
  revalidatePath(`/units/${unitId}`);
}
