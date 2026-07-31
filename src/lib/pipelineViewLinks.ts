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
