'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

export function NavLinks({ links }: { links: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex gap-1 overflow-x-auto -mb-px">
      {links.map((link) => {
        const active =
          pathname === link.href || (link.href !== '/' && pathname.startsWith(`${link.href}/`));
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'whitespace-nowrap px-3 py-2.5 text-sm font-semibold border-b-2 transition-colors',
              active
                ? 'border-navy text-navy'
                : 'border-transparent text-charcoal/60 hover:text-charcoal',
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
