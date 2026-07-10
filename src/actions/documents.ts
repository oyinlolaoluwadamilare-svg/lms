'use server';

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { documents, units } from '@/db/schema';
import { deleteObject, getSignedUploadUrl, isStorageConfigured } from '@/lib/storage';
import { requireUser, requireUnitWrite } from '@/lib/session';
import { writeAudit } from '@/lib/audit';

const MAX_SIZE = 25 * 1024 * 1024; // 25 MB
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv',
]);

/** Step one of an upload: authorise, mint the object key, and return a
 *  presigned PUT URL. The browser uploads straight to Spaces. */
export async function createUploadUrl(input: {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  unitId: string;
}): Promise<{ url: string; key: string }> {
  if (!isStorageConfigured()) {
    throw new Error('File storage is not configured. Set the SPACES_* environment variables.');
  }
  const { fileName, contentType, sizeBytes, unitId } = input;
  await requireUnitWrite(unitId);
  if (!ALLOWED_TYPES.has(contentType)) {
    throw new Error('Only PDF, PNG, JPEG, Word, Excel, and CSV files are allowed.');
  }
  if (sizeBytes > MAX_SIZE) throw new Error('Files are limited to 25 MB.');
  const [unit] = await db.select().from(units).where(eq(units.id, unitId)).limit(1);
  if (!unit) throw new Error('Unknown unit.');

  const safeName = fileName.replace(/[^\w.\- ]/g, '').slice(0, 120) || 'file';
  const year = new Date().getFullYear();
  const key = `documents/${unit.slug}/${year}/${randomUUID()}-${safeName}`;
  const url = await getSignedUploadUrl(key, contentType);
  return { url, key };
}

/** Step two: record the object after the browser confirms the PUT. */
export async function registerDocument(input: {
  key: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  unitId: string;
}): Promise<void> {
  const user = await requireUnitWrite(input.unitId);
  if (!input.key.startsWith('documents/')) throw new Error('Invalid document key.');
  const [row] = await db
    .insert(documents)
    .values({
      unitId: input.unitId,
      spacesKey: input.key,
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      uploadedBy: user.userId,
    })
    .returning();
  await writeAudit(user, 'document.upload', 'documents', row.id, { fileName: input.fileName });
  revalidatePath('/documents');
}

export async function deleteDocument(formData: FormData) {
  const id = formData.get('id')?.toString();
  if (!id) throw new Error('Missing document.');
  const [row] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!row) return;
  const user = await requireUnitWrite(row.unitId ?? '');
  await deleteObject(row.spacesKey).catch((err) => {
    console.error('Spaces delete failed; removing the record anyway', err);
  });
  await db.delete(documents).where(eq(documents.id, id));
  await writeAudit(user, 'document.delete', 'documents', id, { fileName: row.fileName });
  revalidatePath('/documents');
}

/** Unit logo: small public-ish asset, still stored privately and served
 *  through presigned URLs to keep one simple path. */
export async function setUnitLogo(input: {
  unitId: string;
  key: string;
}): Promise<void> {
  const user = await requireUser();
  if (user.role !== 'csst') throw new Error('Only administrators set unit logos.');
  if (!input.key.startsWith('logos/')) throw new Error('Invalid logo key.');
  await db
    .update(units)
    .set({ logoKey: input.key, updatedAt: new Date() })
    .where(eq(units.id, input.unitId));
  await writeAudit(user, 'unit.logo', 'units', input.unitId, {});
  revalidatePath('/admin');
  revalidatePath('/dashboard');
}

export async function createLogoUploadUrl(input: {
  unitId: string;
  contentType: string;
}): Promise<{ url: string; key: string }> {
  const user = await requireUser();
  if (user.role !== 'csst') throw new Error('Only administrators set unit logos.');
  if (!isStorageConfigured()) {
    throw new Error('File storage is not configured. Set the SPACES_* environment variables.');
  }
  if (!['image/png', 'image/jpeg', 'image/svg+xml'].includes(input.contentType)) {
    throw new Error('Logos must be PNG, JPEG, or SVG.');
  }
  const key = `logos/${input.unitId}-${randomUUID()}`;
  const url = await getSignedUploadUrl(key, input.contentType);
  return { url, key };
}
