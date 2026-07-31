import Link from "next/link";

// docs/06-ui-spec.md: "empty (explains the next action, not merely that there is nothing there)."
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-token border border-line bg-raised p-8 text-center">
      <p className="font-medium text-ink">{title}</p>
      <p className="text-sm text-muted">{description}</p>
      {action ? (
        <Link
          href={action.href}
          prefetch={false}
          className="mt-2 rounded-token bg-accent px-4 py-2 text-sm font-medium text-surface outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
