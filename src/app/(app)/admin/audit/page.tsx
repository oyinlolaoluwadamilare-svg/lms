import Link from 'next/link';
import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { auditLog, profiles } from '@/db/schema';
import { user } from '@/db/auth-schema';
import { requireUser } from '@/lib/session';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import type { SearchParams } from '@/lib/page-params';

export const metadata = { title: 'Audit log | Workforce Group CPMS' };

const PAGE_SIZE = 50;

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  const currentUser = await requireUser();
  if (currentUser.role !== 'csst') redirect('/');

  const sp = await searchParams;
  const page = Math.max(1, Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1);

  const rows = await db
    .select({
      id: auditLog.id,
      at: auditLog.at,
      action: auditLog.action,
      entity: auditLog.entity,
      entityId: auditLog.entityId,
      detail: auditLog.detail,
      actorRole: auditLog.actorRole,
      actorName: user.name,
      actorEmail: user.email,
    })
    .from(auditLog)
    .leftJoin(user, eq(auditLog.actorUserId, user.id))
    .orderBy(desc(auditLog.at))
    .limit(PAGE_SIZE + 1)
    .offset((page - 1) * PAGE_SIZE);

  const hasMore = rows.length > PAGE_SIZE;
  const visible = rows.slice(0, PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-charcoal">Audit log</h1>
        <p className="text-sm text-charcoal/60">
          Every write in the system: who did what, to which record, and when.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Page {page}</CardTitle>
        </CardHeader>
        <CardBody className="px-0">
          {visible.length === 0 ? (
            <p className="px-5 pb-3 text-sm text-charcoal/60">Nothing on this page.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Actor</TH>
                  <TH>Role</TH>
                  <TH>Action</TH>
                  <TH>Entity</TH>
                  <TH>Detail</TH>
                </TR>
              </THead>
              <TBody>
                {visible.map((row) => (
                  <TR key={row.id}>
                    <TD className="whitespace-nowrap text-charcoal/70">
                      {row.at.toLocaleString('en-NG', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </TD>
                    <TD>{row.actorName ?? row.actorEmail ?? 'System'}</TD>
                    <TD className="uppercase text-xs font-bold text-charcoal/50">
                      {row.actorRole ?? ''}
                    </TD>
                    <TD className="font-semibold">{row.action}</TD>
                    <TD className="text-charcoal/70">{row.entity}</TD>
                    <TD className="text-xs text-charcoal/60 max-w-64 truncate">
                      {row.detail ? JSON.stringify(row.detail) : ''}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          <div className="flex items-center justify-between px-5 pt-3">
            {page > 1 ? (
              <Link href={`/admin/audit?page=${page - 1}`} className="text-sm font-semibold text-navy hover:underline">
                Newer
              </Link>
            ) : (
              <span />
            )}
            {hasMore && (
              <Link href={`/admin/audit?page=${page + 1}`} className="text-sm font-semibold text-navy hover:underline">
                Older
              </Link>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
