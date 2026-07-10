'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { annualTargets, kpis, monthlyTargets } from '@/db/schema';
import { getFiscalYearId } from '@/lib/fiscal';
import { requireUnitWrite } from '@/lib/session';
import { writeAudit } from '@/lib/audit';

/** Seasonal phasing for revenue-style sums: softer start, steady from Q2. */
const SEASONAL = [6, 7, 8, 8, 9, 9, 9, 8, 9, 9, 9, 9];

async function kpiForWrite(kpiId: string) {
  const [kpi] = await db.select().from(kpis).where(eq(kpis.id, kpiId)).limit(1);
  if (!kpi) throw new Error('KPI not found.');
  // CSST may set targets for any unit; an operator only for their own.
  const user = await requireUnitWrite(kpi.unitId);
  return { kpi, user };
}

/** Save the annual target and optionally rephase the twelve monthly targets.
 *  Phasing: even (flat), seasonal (revenue curve), or keep (leave months). */
export async function saveAnnualTarget(formData: FormData) {
  const kpiId = formData.get('kpiId')?.toString() ?? '';
  const year = Number(formData.get('year'));
  const raw = formData.get('value')?.toString().trim() ?? '';
  const value = Number(raw);
  if (raw === '' || !Number.isFinite(value)) throw new Error('The annual target must be a number.');
  const phasing = formData.get('phasing')?.toString() ?? 'keep';

  const { kpi, user } = await kpiForWrite(kpiId);
  const fiscalYearId = await getFiscalYearId(year);

  await db
    .insert(annualTargets)
    .values({ kpiId, fiscalYearId, value: String(value) })
    .onConflictDoUpdate({
      target: [annualTargets.kpiId, annualTargets.fiscalYearId],
      set: { value: String(value), updatedAt: new Date() },
    });

  if (phasing === 'even' || phasing === 'seasonal') {
    const monthly = Array.from({ length: 12 }, (_, i) => {
      if (kpi.aggregation === 'sum') {
        const share = phasing === 'seasonal' ? SEASONAL[i] / 100 : 1 / 12;
        return Math.round(value * share * 100) / 100;
      }
      // Rates and levels hold the annual figure each month.
      return value;
    });
    for (let m = 1; m <= 12; m++) {
      await db
        .insert(monthlyTargets)
        .values({ kpiId, fiscalYearId, month: m, value: String(monthly[m - 1]) })
        .onConflictDoUpdate({
          target: [monthlyTargets.kpiId, monthlyTargets.fiscalYearId, monthlyTargets.month],
          set: { value: String(monthly[m - 1]), updatedAt: new Date() },
        });
    }
  }

  await writeAudit(user, 'target.annual', 'annual_targets', kpiId, { year, value, phasing });
  revalidatePath('/targets');
  revalidatePath('/report');
  revalidatePath('/dashboard');
}

/** Save the twelve monthly targets directly. Field names: m1 through m12. */
export async function saveMonthlyTargets(formData: FormData) {
  const kpiId = formData.get('kpiId')?.toString() ?? '';
  const year = Number(formData.get('year'));
  const { user } = await kpiForWrite(kpiId);
  const fiscalYearId = await getFiscalYearId(year);

  for (let m = 1; m <= 12; m++) {
    const raw = formData.get(`m${m}`)?.toString().trim() ?? '';
    if (raw === '') {
      await db
        .delete(monthlyTargets)
        .where(
          and(
            eq(monthlyTargets.kpiId, kpiId),
            eq(monthlyTargets.fiscalYearId, fiscalYearId),
            eq(monthlyTargets.month, m),
          ),
        );
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`Month ${m} target must be a number.`);
    await db
      .insert(monthlyTargets)
      .values({ kpiId, fiscalYearId, month: m, value: String(value) })
      .onConflictDoUpdate({
        target: [monthlyTargets.kpiId, monthlyTargets.fiscalYearId, monthlyTargets.month],
        set: { value: String(value), updatedAt: new Date() },
      });
  }

  await writeAudit(user, 'target.monthly', 'monthly_targets', kpiId, { year });
  revalidatePath('/targets');
  revalidatePath('/report');
  revalidatePath('/dashboard');
}
