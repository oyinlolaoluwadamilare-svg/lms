import 'server-only';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  annualTargets,
  aspirations,
  fiscalYears,
  initiatives,
  keyResults,
  kpis,
  monthlyActuals,
  monthlyTargets,
  objectives,
  perspectives,
  submissions,
  units,
} from '@/db/schema';
import type { Dataset, MonthEntry } from './types';

const toNumber = (value: string | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value);

export async function listFiscalYears(): Promise<{ year: number; active: boolean }[]> {
  const rows = await db
    .select({ year: fiscalYears.year, active: fiscalYears.active })
    .from(fiscalYears)
    .orderBy(asc(fiscalYears.year));
  return rows;
}

export async function getDefaultYear(): Promise<number> {
  const years = await listFiscalYears();
  const active = years.find((y) => y.active);
  return active?.year ?? years.at(-1)?.year ?? new Date().getFullYear();
}

/** Load the whole scorecard for one fiscal year as a plain, serializable
 *  Dataset. All numeric strings are coerced here, once, so the engine and
 *  every screen work with numbers. Returns null for an unknown year. */
export async function loadDataset(year: number): Promise<Dataset | null> {
  const [fy] = await db.select().from(fiscalYears).where(eq(fiscalYears.year, year)).limit(1);
  if (!fy) return null;
  const fyId = fy.id;

  const [
    unitRows,
    perspectiveRows,
    objectiveRows,
    aspirationRows,
    kpiRows,
    annualRows,
    monthlyTargetRows,
    actualRows,
    initiativeRows,
    submissionRows,
  ] = await Promise.all([
    db.select().from(units).orderBy(asc(units.sortOrder), asc(units.name)),
    db.select().from(perspectives).orderBy(asc(perspectives.sortOrder)),
    db
      .select()
      .from(objectives)
      .where(eq(objectives.fiscalYearId, fyId))
      .orderBy(asc(objectives.sortOrder)),
    db.select().from(aspirations).where(eq(aspirations.fiscalYearId, fyId)),
    db
      .select()
      .from(kpis)
      .where(eq(kpis.fiscalYearId, fyId))
      .orderBy(asc(kpis.sortOrder), asc(kpis.name)),
    db.select().from(annualTargets).where(eq(annualTargets.fiscalYearId, fyId)),
    db.select().from(monthlyTargets).where(eq(monthlyTargets.fiscalYearId, fyId)),
    db.select().from(monthlyActuals).where(eq(monthlyActuals.fiscalYearId, fyId)),
    db.select().from(initiatives).where(eq(initiatives.fiscalYearId, fyId)),
    db.select().from(submissions).where(eq(submissions.fiscalYearId, fyId)),
  ]);

  const objectiveIds = new Set(objectiveRows.map((o) => o.id));
  const keyResultRows =
    objectiveIds.size > 0
      ? (await db.select().from(keyResults).orderBy(asc(keyResults.sortOrder))).filter((kr) =>
          objectiveIds.has(kr.objectiveId),
        )
      : [];

  const annualMap: Record<string, number> = {};
  for (const row of annualRows) {
    const v = toNumber(row.value);
    if (v !== null) annualMap[row.kpiId] = v;
  }

  const monthlyTargetMap: Record<string, (number | null)[]> = {};
  for (const row of monthlyTargetRows) {
    (monthlyTargetMap[row.kpiId] ??= Array(12).fill(null))[row.month - 1] = toNumber(row.value);
  }

  const actualMap: Record<string, MonthEntry[]> = {};
  for (const row of actualRows) {
    (actualMap[row.kpiId] ??= Array.from({ length: 12 }, () => ({ value: null, note: null })))[
      row.month - 1
    ] = { value: toNumber(row.value), note: row.note };
  }

  return {
    year,
    units: unitRows.map((u) => ({
      id: u.id,
      name: u.name,
      slug: u.slug,
      type: u.type,
      weight: toNumber(u.weight) ?? 1,
      logoKey: u.logoKey,
      sortOrder: u.sortOrder,
      active: u.active,
    })),
    perspectives: perspectiveRows.map((p) => ({
      id: p.id,
      name: p.name,
      sortOrder: p.sortOrder,
    })),
    objectives: objectiveRows.map((o) => ({
      id: o.id,
      kind: o.kind,
      unitId: o.unitId,
      perspectiveId: o.perspectiveId,
      parentId: o.parentId,
      title: o.title,
      framework: o.framework,
      weight: toNumber(o.weight) ?? 1,
      sortOrder: o.sortOrder,
    })),
    keyResults: keyResultRows.map((kr) => ({
      id: kr.id,
      objectiveId: kr.objectiveId,
      title: kr.title,
      targetText: kr.targetText,
      currentText: kr.currentText,
      sortOrder: kr.sortOrder,
    })),
    aspirations: aspirationRows.map((a) => ({ id: a.id, unitId: a.unitId, text: a.text })),
    kpis: kpiRows.map((k) => ({
      id: k.id,
      unitId: k.unitId,
      objectiveId: k.objectiveId,
      perspectiveId: k.perspectiveId,
      name: k.name,
      uom: k.uom,
      direction: k.direction,
      weight: toNumber(k.weight) ?? 1,
      cadence: k.cadence,
      aggregation: k.aggregation,
      sortOrder: k.sortOrder,
      active: k.active,
    })),
    annualTargets: annualMap,
    monthlyTargets: monthlyTargetMap,
    monthlyActuals: actualMap,
    initiatives: initiativeRows.map((i) => ({
      id: i.id,
      unitId: i.unitId,
      kpiId: i.kpiId,
      title: i.title,
      owner: i.owner,
      dueDate: i.dueDate,
      status: i.status,
      note: i.note,
    })),
    submissions: submissionRows.map((s) => ({
      id: s.id,
      unitId: s.unitId,
      periodKind: s.periodKind,
      periodIndex: s.periodIndex,
      narrative: s.narrative,
      status: s.status,
      submittedBy: s.submittedBy,
      submittedAt: s.submittedAt?.toISOString() ?? null,
      reviewedBy: s.reviewedBy,
      reviewedAt: s.reviewedAt?.toISOString() ?? null,
      rating: s.rating,
      reviewComment: s.reviewComment,
    })),
  };
}
