import { desc, inArray } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { documents } from '@/db/schema';
import { requireUser } from '@/lib/session';
import { resolvePeriodContext, type SearchParams } from '@/lib/page-params';
import { isStorageConfigured } from '@/lib/storage';
import { deleteDocument } from '@/actions/documents';
import { UploadButton } from '@/components/documents/upload-button';
import { PdfPreview } from '@/components/documents/pdf-preview';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/format';

export const metadata = { title: 'Documents | Workforce Group CPMS' };

const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export default async function DocumentsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const { ds } = await resolvePeriodContext(searchParams);
  if (!ds) redirect('/dashboard');
  const sp = await searchParams;

  const visibleUnits = ds.units.filter(
    (u) => u.active && (user.role !== 'lob' || u.id === user.unitId),
  );
  const focusUnitId =
    user.role === 'lob' ? user.unitId : (first(sp.unit) ?? visibleUnits[0]?.id);
  const focusUnit = visibleUnits.find((u) => u.id === focusUnitId) ?? visibleUnits[0];

  const visibleIds = visibleUnits.map((u) => u.id);
  const rows =
    visibleIds.length > 0
      ? await db
          .select()
          .from(documents)
          .where(inArray(documents.unitId, visibleIds))
          .orderBy(desc(documents.createdAt))
      : [];

  const configured = isStorageConfigured();
  const canUpload = user.role !== 'emt' && focusUnit;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-charcoal">Documents</h1>
          <p className="text-sm text-charcoal/60">
            Confidential reports and evidence, stored privately with short-lived access links.
          </p>
        </div>
        {canUpload && configured && (
          <div className="flex items-center gap-2">
            {user.role === 'csst' && visibleUnits.length > 1 && (
              <form method="get" className="flex items-center gap-1.5">
                <Select name="unit" defaultValue={focusUnit?.id} aria-label="Unit" className="w-48 py-1.5">
                  {visibleUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
                <Button type="submit" variant="secondary" size="sm">
                  Switch
                </Button>
              </form>
            )}
            {focusUnit && <UploadButton unitId={focusUnit.id} />}
          </div>
        )}
      </div>

      {!configured && (
        <Card className="p-4 bg-rag-amber-bg border-rag-amber/30">
          <p className="text-sm font-bold text-rag-amber">File storage is not configured</p>
          <p className="text-sm text-charcoal/70 mt-1">
            Document upload and preview activate when the DigitalOcean Spaces credentials
            (SPACES_KEY, SPACES_SECRET, SPACES_ENDPOINT, SPACES_BUCKET) are set. Everything else
            in the app works without them.
          </p>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            {user.role === 'lob' ? 'Your unit&apos;s files' : 'All files'} ({rows.length})
          </CardTitle>
        </CardHeader>
        <CardBody>
          {rows.length === 0 ? (
            <p className="text-sm text-charcoal/60">
              Nothing here yet.{' '}
              {configured
                ? 'Upload the first supporting document for a reporting period.'
                : 'Files will appear here once storage is configured and the first document is uploaded.'}
            </p>
          ) : (
            <ul className="space-y-4">
              {rows.map((doc) => {
                const unit = ds.units.find((u) => u.id === doc.unitId);
                return (
                  <li key={doc.id} className="border-b border-line pb-4 last:border-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <a
                          href={`/api/documents/${doc.id}`}
                          target="_blank"
                          className="font-semibold text-navy hover:underline"
                        >
                          {doc.fileName}
                        </a>
                        <p className="text-xs text-charcoal/60">
                          {unit?.name ?? 'Group'} · {formatSize(doc.sizeBytes)} · uploaded{' '}
                          {formatDate(doc.createdAt.toISOString())}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <a href={`/api/documents/${doc.id}?download=1`}>
                          <Button variant="secondary" size="sm">
                            Download
                          </Button>
                        </a>
                        {user.role !== 'emt' && (
                          <form action={deleteDocument}>
                            <input type="hidden" name="id" value={doc.id} />
                            <ConfirmButton
                              message={`Delete "${doc.fileName}"?`}
                              variant="ghost"
                              size="sm"
                            >
                              Delete
                            </ConfirmButton>
                          </form>
                        )}
                      </div>
                    </div>
                    {doc.contentType === 'application/pdf' && configured && (
                      <PdfPreview documentId={doc.id} fileName={doc.fileName} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
