import Link from "next/link";
import { ACTIVITY_TYPES, ACTIVITY_TYPE_LABELS } from "@/domain/activity";

// docs/06-ui-spec.md: "Filter by type and author." A plain GET form against the deal's own URL,
// the same reasoning app/(app)/deals/PipelineFilters.tsx already established: filters are just
// search params, no client JS required for them to work.
export function TimelineFilters({
  dealId,
  values,
  authors,
}: {
  dealId: string;
  values: { type?: string; author?: string };
  authors: Array<{ id: string; name: string }>;
}) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="type" className="text-xs font-medium text-muted">
          Type
        </label>
        <select
          id="type"
          name="type"
          defaultValue={values.type ?? ""}
          className="rounded-token border border-line bg-surface px-2 py-1 text-xs text-ink outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="">Any</option>
          {ACTIVITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {ACTIVITY_TYPE_LABELS[t]}
            </option>
          ))}
          <option value="stage_change">Stage change</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="author" className="text-xs font-medium text-muted">
          Author
        </label>
        <select
          id="author"
          name="author"
          defaultValue={values.author ?? ""}
          className="rounded-token border border-line bg-surface px-2 py-1 text-xs text-ink outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="">Any</option>
          {authors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        className="rounded-token bg-accent px-3 py-1 text-xs font-medium text-surface outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Apply
      </button>
      {values.type || values.author ? (
        <Link
          href={`/deals/${dealId}`}
          prefetch={false}
          className="rounded-token border border-line px-3 py-1 text-xs font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Clear
        </Link>
      ) : null}
    </form>
  );
}
