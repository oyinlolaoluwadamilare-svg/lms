import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { documents } from '@/db/schema';
import { getCurrentUser } from '@/lib/session';
import { getSignedViewUrl, isStorageConfigured } from '@/lib/storage';

/** Redirect to a short-lived presigned URL for the document. Operators can
 *  only open their own unit's files; CSST and EMT can open any. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: 'File storage is not configured.' }, { status: 503 });
  }

  const { id } = await params;
  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc) return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
  if (user.role === 'lob' && doc.unitId !== user.unitId) {
    return NextResponse.json({ error: 'You do not have access to this document.' }, { status: 403 });
  }

  const inline = request.nextUrl.searchParams.get('download') !== '1';
  const url = await getSignedViewUrl(doc.spacesKey, doc.fileName, doc.contentType, inline);
  return NextResponse.redirect(url, 307);
}
