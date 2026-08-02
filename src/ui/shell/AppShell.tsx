import type { ReactNode } from "react";
import Link from "next/link";
import type { NavItem } from "@/domain/navigation";
import { Nav } from "@/ui/nav/Nav";

// Presentational only (docs/03-architecture.md: "ui/ presentational only, no data fetching") -
// the session/role resolution that produces navItems/userName/tenantName happens in
// app/(app)/layout.tsx, the only place allowed to call services.
export function AppShell({
  navItems,
  userName,
  tenantName,
  children,
}: {
  navItems: readonly NavItem[];
  userName: string;
  tenantName: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <header className="flex flex-col justify-between border-b border-line bg-raised md:w-56 md:border-b-0 md:border-r">
        <div>
          <div className="border-b border-line p-4">
            <p className="text-sm font-semibold text-ink">Pipeline Intelligence</p>
            <p className="text-xs text-muted">{tenantName}</p>
          </div>
          <Nav items={navItems} />
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-line p-4">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="truncate text-xs text-muted">{userName}</p>
            {/* Notification preferences (M4.8) is a personal setting, not a role-gated screen - it
                lives here rather than in the role-specific Nav so every role, regardless of what
                else appears in their own sidebar, can always reach it. */}
            <Link
              href="/notifications/preferences"
              prefetch={false}
              className="truncate text-xs font-medium text-accent outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Notification preferences
            </Link>
          </div>
          <form action="/sign-out" method="post">
            <button
              type="submit"
              className="rounded-token border border-line px-2 py-1 text-xs font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
