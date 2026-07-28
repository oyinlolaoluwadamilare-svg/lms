import type { NavItem } from "@/domain/navigation";

export function Nav({ items }: { items: readonly NavItem[] }) {
  return (
    <nav aria-label="Primary" className="flex flex-col gap-1 p-4">
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          className="rounded-token px-3 py-2 text-sm font-medium text-ink outline-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent"
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
