import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { resolvePeriodContext, type SearchParams } from '@/lib/page-params';
import { cn } from '@/lib/cn';
import { UnitsTab } from '@/components/admin/units-tab';
import { PerspectivesTab } from '@/components/admin/perspectives-tab';
import { ObjectivesTab } from '@/components/admin/objectives-tab';
import { KpisTab } from '@/components/admin/kpis-tab';

export const metadata = { title: 'Administration | Workforce Group CPMS' };

const TABS = [
  { key: 'units', label: 'Units' },
  { key: 'perspectives', label: 'Perspectives' },
  { key: 'objectives', label: 'Objectives' },
  { key: 'kpis', label: 'KPIs' },
] as const;

const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

export default async function AdminPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (user.role !== 'csst') redirect('/');

  const { ds, year } = await resolvePeriodContext(searchParams);
  if (!ds) redirect('/dashboard');
  const sp = await searchParams;
  const tab = first(sp.tab) ?? 'units';
  const unitParam = first(sp.unit);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-charcoal">Administration</h1>
          <p className="text-sm text-charcoal/60">
            The scorecard&apos;s definitions for FY {year}: units, perspectives, objectives, and
            KPIs. Targets have{' '}
            <Link href="/targets" className="text-navy font-semibold hover:underline">
              their own editor
            </Link>
            , and every change lands in the{' '}
            <Link href="/admin/audit" className="text-navy font-semibold hover:underline">
              audit log
            </Link>
            .
          </p>
        </div>
      </div>

      <nav aria-label="Admin sections" className="flex gap-1 border-b border-line overflow-x-auto">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin?tab=${t.key}`}
            aria-current={tab === t.key ? 'page' : undefined}
            className={cn(
              'whitespace-nowrap px-3 py-2 text-sm font-semibold border-b-2 -mb-px',
              tab === t.key
                ? 'border-navy text-navy'
                : 'border-transparent text-charcoal/60 hover:text-charcoal',
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'units' && <UnitsTab ds={ds} year={year} />}
      {tab === 'perspectives' && <PerspectivesTab ds={ds} />}
      {tab === 'objectives' && <ObjectivesTab ds={ds} year={year} />}
      {tab === 'kpis' && <KpisTab ds={ds} year={year} unitParam={unitParam} />}
    </div>
  );
}
