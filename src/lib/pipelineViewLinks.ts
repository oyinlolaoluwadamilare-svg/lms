export interface PipelineSearchParams {
  stage?: string;
  owner?: string;
  practiceLine?: string;
  account?: string;
  clientType?: string;
  forecastCategory?: string;
  status?: string;
  closeFrom?: string;
  closeTo?: string;
  view?: string;
  daysSinceEngagement?: string;
  sort?: string;
  dir?: string;
}

// Builds the other view's link, preserving every current filter - docs/06-ui-spec.md's Pipeline
// screen is one screen with two views ("Board and table, as today"), not two separate filter sets.
// Pure and framework-free on purpose (src/lib per CLAUDE.md's layering table: "cross-cutting
// helpers, importable anywhere") so this is unit-testable directly, without a browser - the actual
// client-side navigation behaviour of the Link that uses this href is exercised by
// tests/e2e/pipeline.spec.ts instead.
export function viewToggleHref(params: PipelineSearchParams, targetView: "table" | "board"): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key !== "view" && value) query.set(key, value);
  }
  if (targetView === "board") query.set("view", "board");
  const queryString = query.toString();
  return queryString ? `/deals?${queryString}` : "/deals";
}

// Builds the "Last engaged" column header's link (docs/06-ui-spec.md: "a last-engaged column and
// sort in the table") - preserves every other current param, the same way viewToggleHref does.
// First click sorts ascending (most-stale-first: src/data/deals.ts's own reasoning is that
// ascending puts never-engaged and the oldest real dates first, the more actionable direction for
// a column whose whole point is surfacing at-risk deals); a second click while already sorted by
// this column toggles the direction. There is only one sortable column so far (M3.7), so there is
// no "sorted by a different column" case to preserve or clear yet.
export function lastEngagedSortHref(params: PipelineSearchParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key !== "sort" && key !== "dir" && value) query.set(key, value);
  }
  const isSortedByThis = params.sort === "lastEngaged";
  const nextDir = isSortedByThis && params.dir !== "desc" ? "desc" : "asc";
  query.set("sort", "lastEngaged");
  query.set("dir", nextDir);
  return `/deals?${query.toString()}`;
}
