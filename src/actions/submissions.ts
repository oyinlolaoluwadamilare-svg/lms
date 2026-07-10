'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { submissions } from '@/db/schema';
import { getFiscalYearId } from '@/lib/fiscal';
import { requireRole, resolveActingUnit } from '@/lib/session';
import { writeAudit } from '@/lib/audit';
import type { PeriodKind } from '@/lib/types';

function parsePeriod(formData: FormData): { periodKind: PeriodKind; periodIndex: number } {
  const periodKind = formData.get('periodKind')?.toString() as PeriodKind;
  const periodIndex = Number(formData.get('periodIndex'));
  const max = { month: 12, quarter: 4, half: 2, year: 1 }[periodKind];
  if (!max || !Number.isInteger(periodIndex) || periodIndex < 1 || periodIndex > max) {
    throw new Error('Invalid reporting period.');
  }
  return { periodKind, periodIndex };
}

async function findSubmission(
  unitId: string,
  fiscalYearId: string,
  periodKind: PeriodKind,
  periodIndex: number,
) {
  const [row] = await db
    .select()
    .from(submissions)
    .where(
      and(
        eq(submissions.unitId, unitId),
        eq(submissions.fiscalYearId, fiscalYearId),
        eq(submissions.periodKind, periodKind),
        eq(submissions.periodIndex, periodIndex),
      ),
    );
  return row ?? null;
}

/** Save the narrative without submitting. Allowed while draft or returned. */
export async function saveDraftNarrative(formData: FormData) {
  const year = Number(formData.get('year'));
  const { user, unitId } = await resolveActingUnit(formData.get('unit')?.toString());
  const fiscalYearId = await getFiscalYearId(year);
  const { periodKind, periodIndex } = parsePeriod(formData);
  const narrative = formData.get('narrative')?.toString() ?? '';

  const existing = await findSubmission(unitId, fiscalYearId, periodKind, periodIndex);
  if (existing && (existing.status === 'submitted' || existing.status === 'approved')) {
    throw new Error('This period has already been submitted.');
  }
  if (existing) {
    await db
      .update(submissions)
      .set({ narrative, updatedAt: new Date() })
      .where(eq(submissions.id, existing.id));
  } else {
    await db
      .insert(submissions)
      .values({ unitId, fiscalYearId, periodKind, periodIndex, narrative, status: 'draft' });
  }
  await writeAudit(user, 'submission.draft', 'submissions', existing?.id ?? null, {
    periodKind,
    periodIndex,
  });
  revalidatePath('/report');
}

/** Submit a period for EMT review. Locks the narrative. */
export async function submitPeriod(formData: FormData) {
  const year = Number(formData.get('year'));
  const { user, unitId } = await resolveActingUnit(formData.get('unit')?.toString());
  const fiscalYearId = await getFiscalYearId(year);
  const { periodKind, periodIndex } = parsePeriod(formData);
  const narrative = formData.get('narrative')?.toString().trim() ?? '';
  if (!narrative) {
    throw new Error('Add a short reporting note before submitting: it is what the EMT reads first.');
  }

  const existing = await findSubmission(unitId, fiscalYearId, periodKind, periodIndex);
  if (existing && existing.status === 'approved') {
    throw new Error('This period has already been signed off.');
  }
  if (existing && existing.status === 'submitted') {
    throw new Error('This period is already with the EMT for review.');
  }

  if (existing) {
    await db
      .update(submissions)
      .set({
        narrative,
        status: 'submitted',
        submittedBy: user.userId,
        submittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(submissions.id, existing.id));
  } else {
    await db.insert(submissions).values({
      unitId,
      fiscalYearId,
      periodKind,
      periodIndex,
      narrative,
      status: 'submitted',
      submittedBy: user.userId,
      submittedAt: new Date(),
    });
  }
  await writeAudit(user, 'submission.submit', 'submissions', existing?.id ?? null, {
    periodKind,
    periodIndex,
  });
  revalidatePath('/report');
  revalidatePath('/review');
  revalidatePath('/dashboard');
}

/** EMT sign-off with a rating and comment. */
export async function approveSubmission(formData: FormData) {
  const user = await requireRole('emt');
  const id = formData.get('id')?.toString();
  const rating = Number(formData.get('rating'));
  const comment = formData.get('comment')?.toString().trim() ?? '';
  if (!id) throw new Error('Missing submission.');
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error('Give a rating from 1 to 5.');
  }
  const [row] = await db.select().from(submissions).where(eq(submissions.id, id));
  if (!row || row.status !== 'submitted') {
    throw new Error('Only a submitted period can be signed off.');
  }
  await db
    .update(submissions)
    .set({
      status: 'approved',
      reviewedBy: user.userId,
      reviewedAt: new Date(),
      rating,
      reviewComment: comment || null,
      updatedAt: new Date(),
    })
    .where(eq(submissions.id, id));
  await writeAudit(user, 'submission.approve', 'submissions', id, { rating });
  revalidatePath('/review');
  revalidatePath('/dashboard');
}

/** EMT returns a period to the unit with a comment to address. */
export async function returnSubmission(formData: FormData) {
  const user = await requireRole('emt');
  const id = formData.get('id')?.toString();
  const comment = formData.get('comment')?.toString().trim() ?? '';
  if (!id) throw new Error('Missing submission.');
  if (!comment) throw new Error('Tell the unit what to fix before returning the report.');
  const [row] = await db.select().from(submissions).where(eq(submissions.id, id));
  if (!row || row.status !== 'submitted') {
    throw new Error('Only a submitted period can be returned.');
  }
  await db
    .update(submissions)
    .set({
      status: 'returned',
      reviewedBy: user.userId,
      reviewedAt: new Date(),
      reviewComment: comment,
      updatedAt: new Date(),
    })
    .where(eq(submissions.id, id));
  await writeAudit(user, 'submission.return', 'submissions', id, {});
  revalidatePath('/review');
  revalidatePath('/report');
  revalidatePath('/dashboard');
}
