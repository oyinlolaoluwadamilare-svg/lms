'use server';

import { revalidatePath } from 'next/cache';
import { count, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  aspirations,
  keyResults,
  kpis,
  objectives,
  perspectives,
  profiles,
  units,
} from '@/db/schema';
import { auth } from '@/lib/auth';
import { getFiscalYearId } from '@/lib/fiscal';
import { requireRole, requireUnitWrite } from '@/lib/session';
import { writeAudit } from '@/lib/audit';

function text(formData: FormData, key: string, required = true): string {
  const v = formData.get(key)?.toString().trim() ?? '';
  if (required && !v) throw new Error(`Missing ${key}.`);
  return v;
}

function num(formData: FormData, key: string, fallback?: number): number {
  const raw = formData.get(key)?.toString().trim();
  if (!raw) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing ${key}.`);
  }
  const v = Number(raw);
  if (!Number.isFinite(v)) throw new Error(`${key} must be a number.`);
  return v;
}

function revalidateAdmin() {
  revalidatePath('/admin');
  revalidatePath('/dashboard');
  revalidatePath('/analytics');
}

/* ---------------- Units ---------------- */

/** Create a unit together with its operator login, per the brief:
 *  adding a unit creates its login. */
export async function createUnit(formData: FormData) {
  const user = await requireRole('csst');
  const name = text(formData, 'name');
  const slug = text(formData, 'slug').toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!slug) throw new Error('Give the unit a slug (letters, numbers, hyphens).');
  const type = (formData.get('type')?.toString() ?? 'LOB') as 'LOB' | 'AOB' | 'Unit';
  const weight = num(formData, 'weight', 1);
  const email = text(formData, 'email', false) || `${slug}@wfg.demo`;
  const password = text(formData, 'password', false) || 'wfg2026';

  const [unit] = await db
    .insert(units)
    .values({ name, slug, type, weight: String(weight) })
    .returning();

  const res = await auth.api.signUpEmail({
    body: { email, password, name: `MD, ${name}` },
  });
  if (!res.user) throw new Error('The unit was created but its login could not be.');
  await db.insert(profiles).values({
    userId: res.user.id,
    role: 'lob',
    unitId: unit.id,
    fullName: `MD, ${name}`,
  });

  await writeAudit(user, 'unit.create', 'units', unit.id, { name, operator: email });
  revalidateAdmin();
}

export async function updateUnit(formData: FormData) {
  const user = await requireRole('csst');
  const id = text(formData, 'id');
  const name = text(formData, 'name');
  const type = (formData.get('type')?.toString() ?? 'LOB') as 'LOB' | 'AOB' | 'Unit';
  const weight = num(formData, 'weight', 1);
  const active = formData.get('active') === 'on';
  await db
    .update(units)
    .set({ name, type, weight: String(weight), active, updatedAt: new Date() })
    .where(eq(units.id, id));
  await writeAudit(user, 'unit.update', 'units', id, { name, weight, active });
  revalidateAdmin();
}

export async function saveAspiration(formData: FormData) {
  const unitId = text(formData, 'unitId');
  const user = await requireUnitWrite(unitId);
  const year = num(formData, 'year');
  const fiscalYearId = await getFiscalYearId(year);
  const value = text(formData, 'text', false);
  const [existing] = await db
    .select()
    .from(aspirations)
    .where(eq(aspirations.unitId, unitId))
    .limit(1);
  if (existing) {
    await db
      .update(aspirations)
      .set({ text: value, updatedAt: new Date() })
      .where(eq(aspirations.id, existing.id));
  } else if (value) {
    await db.insert(aspirations).values({ unitId, fiscalYearId, text: value });
  }
  await writeAudit(user, 'aspiration.save', 'aspirations', unitId, {});
  revalidateAdmin();
  revalidatePath(`/units/${unitId}`);
}

/* ---------------- Perspectives ---------------- */

export async function createPerspective(formData: FormData) {
  const user = await requireRole('csst');
  const name = text(formData, 'name');
  const [row] = await db
    .insert(perspectives)
    .values({ name, sortOrder: num(formData, 'sortOrder', 99) })
    .returning();
  await writeAudit(user, 'perspective.create', 'perspectives', row.id, { name });
  revalidateAdmin();
}

export async function updatePerspective(formData: FormData) {
  const user = await requireRole('csst');
  const id = text(formData, 'id');
  const name = text(formData, 'name');
  await db.update(perspectives).set({ name, updatedAt: new Date() }).where(eq(perspectives.id, id));
  await writeAudit(user, 'perspective.update', 'perspectives', id, { name });
  revalidateAdmin();
}

export async function deletePerspective(formData: FormData) {
  const user = await requireRole('csst');
  const id = text(formData, 'id');
  const [{ inUse }] = await db
    .select({ inUse: count() })
    .from(kpis)
    .where(eq(kpis.perspectiveId, id));
  if (inUse > 0) {
    throw new Error('This perspective is used by KPIs. Move them first.');
  }
  await db.delete(perspectives).where(eq(perspectives.id, id));
  await writeAudit(user, 'perspective.delete', 'perspectives', id, {});
  revalidateAdmin();
}

/* ---------------- Objectives and key results ---------------- */

export async function createObjective(formData: FormData) {
  const user = await requireRole('csst');
  const year = num(formData, 'year');
  const fiscalYearId = await getFiscalYearId(year);
  const kind = formData.get('kind') === 'group' ? ('group' as const) : ('unit' as const);
  const unitId = kind === 'unit' ? text(formData, 'unitId') : null;
  const [row] = await db
    .insert(objectives)
    .values({
      kind,
      unitId,
      fiscalYearId,
      perspectiveId: formData.get('perspectiveId')?.toString() || null,
      parentId: formData.get('parentId')?.toString() || null,
      title: text(formData, 'title'),
      framework: formData.get('framework') === 'OKR' ? 'OKR' : 'MBO',
      weight: String(num(formData, 'weight', 1)),
      sortOrder: num(formData, 'sortOrder', 99),
    })
    .returning();
  await writeAudit(user, 'objective.create', 'objectives', row.id, { title: row.title, kind });
  revalidateAdmin();
}

export async function updateObjective(formData: FormData) {
  const user = await requireRole('csst');
  const id = text(formData, 'id');
  await db
    .update(objectives)
    .set({
      title: text(formData, 'title'),
      perspectiveId: formData.get('perspectiveId')?.toString() || null,
      parentId: formData.get('parentId')?.toString() || null,
      framework: formData.get('framework') === 'OKR' ? 'OKR' : 'MBO',
      weight: String(num(formData, 'weight', 1)),
      updatedAt: new Date(),
    })
    .where(eq(objectives.id, id));
  await writeAudit(user, 'objective.update', 'objectives', id, {});
  revalidateAdmin();
}

export async function deleteObjective(formData: FormData) {
  const user = await requireRole('csst');
  const id = text(formData, 'id');
  const [{ inUse }] = await db
    .select({ inUse: count() })
    .from(kpis)
    .where(eq(kpis.objectiveId, id));
  if (inUse > 0) throw new Error('This objective has KPIs. Move or delete them first.');
  await db.delete(objectives).where(eq(objectives.id, id));
  await writeAudit(user, 'objective.delete', 'objectives', id, {});
  revalidateAdmin();
}

export async function createKeyResult(formData: FormData) {
  const user = await requireRole('csst');
  const objectiveId = text(formData, 'objectiveId');
  const [row] = await db
    .insert(keyResults)
    .values({
      objectiveId,
      title: text(formData, 'title'),
      targetText: text(formData, 'targetText', false) || null,
    })
    .returning();
  await writeAudit(user, 'key_result.create', 'key_results', row.id, {});
  revalidateAdmin();
}

export async function deleteKeyResult(formData: FormData) {
  const user = await requireRole('csst');
  const id = text(formData, 'id');
  await db.delete(keyResults).where(eq(keyResults.id, id));
  await writeAudit(user, 'key_result.delete', 'key_results', id, {});
  revalidateAdmin();
}

/* ---------------- KPIs ---------------- */

const KPI_FIELDS = (formData: FormData) => ({
  name: text(formData, 'name'),
  uom: text(formData, 'uom'),
  direction: formData.get('direction') === 'lower' ? ('lower' as const) : ('higher' as const),
  weight: String(num(formData, 'weight', 1)),
  cadence:
    formData.get('cadence') === 'one_off' ? ('one_off' as const) : ('continuous' as const),
  aggregation: (['sum', 'average', 'end'].includes(formData.get('aggregation')?.toString() ?? '')
    ? formData.get('aggregation')?.toString()
    : 'sum') as 'sum' | 'average' | 'end',
});

export async function createKpi(formData: FormData) {
  const user = await requireRole('csst');
  const year = num(formData, 'year');
  const fiscalYearId = await getFiscalYearId(year);
  const unitId = text(formData, 'unitId');
  const objectiveId = text(formData, 'objectiveId');
  const perspectiveId = text(formData, 'perspectiveId');
  const fields = KPI_FIELDS(formData);
  // A one-off deliverable is judged at period end, never summed or averaged.
  if (fields.cadence === 'one_off') fields.aggregation = 'end';
  const [row] = await db
    .insert(kpis)
    .values({ unitId, objectiveId, perspectiveId, fiscalYearId, ...fields })
    .returning();
  await writeAudit(user, 'kpi.create', 'kpis', row.id, { name: fields.name });
  revalidateAdmin();
}

export async function updateKpi(formData: FormData) {
  const user = await requireRole('csst');
  const id = text(formData, 'id');
  const fields = KPI_FIELDS(formData);
  if (fields.cadence === 'one_off') fields.aggregation = 'end';
  await db
    .update(kpis)
    .set({
      ...fields,
      objectiveId: text(formData, 'objectiveId'),
      perspectiveId: text(formData, 'perspectiveId'),
      active: formData.get('active') === 'on',
      updatedAt: new Date(),
    })
    .where(eq(kpis.id, id));
  await writeAudit(user, 'kpi.update', 'kpis', id, { name: fields.name });
  revalidateAdmin();
}

export async function deleteKpi(formData: FormData) {
  const user = await requireRole('csst');
  const id = text(formData, 'id');
  await db.delete(kpis).where(eq(kpis.id, id));
  await writeAudit(user, 'kpi.delete', 'kpis', id, {});
  revalidateAdmin();
}
