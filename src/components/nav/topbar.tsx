import Link from 'next/link';
import { signOut } from '@/actions/auth';
import { Button } from '@/components/ui/button';
import type { Role } from '@/lib/types';
import { NavLinks } from './nav-links';

const roleLabels: Record<Role, string> = {
  csst: 'Admin',
  emt: 'Reviewer',
  lob: 'Operator',
};

export function Topbar({
  name,
  email,
  role,
  unitId,
}: {
  name: string;
  email: string;
  role: Role;
  unitId: string | null;
}) {
  const links: { href: string; label: string }[] = [];
  if (role === 'lob') {
    links.push({ href: '/report', label: 'Report actuals' });
    if (unitId) links.push({ href: `/units/${unitId}`, label: 'My unit' });
  } else {
    links.push({ href: '/dashboard', label: 'Dashboard' });
  }
  if (role === 'emt') links.push({ href: '/review', label: 'Review' });
  if (role === 'lob') links.push({ href: '/targets', label: 'Targets' });
  links.push({ href: '/analytics', label: 'Analytics' });
  links.push({ href: '/documents', label: 'Documents' });
  if (role === 'csst') links.push({ href: '/admin', label: 'Administration' });

  return (
    <header className="bg-card border-b border-line sticky top-0 z-20">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          <Link href="/" className="flex items-baseline gap-2 shrink-0">
            <span className="font-bold text-charcoal tracking-tight">WORKFORCE GROUP</span>
            <span className="text-midblue font-semibold text-sm">CPMS</span>
          </Link>
          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-right leading-tight">
              <p className="text-sm font-semibold text-charcoal">{name || email}</p>
              <p className="text-xs text-charcoal/60">{roleLabels[role]}</p>
            </div>
            <form action={signOut}>
              <Button variant="secondary" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </div>
        <NavLinks links={links} />
      </div>
    </header>
  );
}
