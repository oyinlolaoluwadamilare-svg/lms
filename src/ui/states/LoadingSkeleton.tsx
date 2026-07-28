// docs/06-ui-spec.md: "loading (skeleton matching final layout, never a spinner alone)." Generic
// row-count skeleton until a real list layout (My Work, Pipeline board, etc.) exists to shape it
// more precisely - callers pass `rows` to roughly match what they expect to render.
export function LoadingSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" className="flex flex-col gap-3">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden className="h-14 animate-pulse rounded-token bg-raised" />
      ))}
    </div>
  );
}
