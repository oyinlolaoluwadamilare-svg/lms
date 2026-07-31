import Link from "next/link";
import type { NavItem } from "@/domain/navigation";

// prefetch={false}: every destination here is a fully dynamic, per-session, RLS-gated page - Next's
// default hover/viewport prefetch would fire a real Supabase-backed server round trip for every
// nav item on every render, for a page that's rarely visited and whose content differs by session
// anyway. No UX loss (the click itself is still fast), and it removes a source of unnecessary
// backend load this session's real hosted project has already shown occasional latency against.
export function Nav({ items }: { items: readonly NavItem[] }) {
  return (
    <nav aria-label="Primary" className="flex flex-col gap-1 p-4">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          prefetch={false}
          className="rounded-token px-3 py-2 text-sm font-medium text-ink outline-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
