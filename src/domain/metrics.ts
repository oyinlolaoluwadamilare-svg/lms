// docs/04-metric-definitions.md's own "Presentation rules that apply to every metric": "Show the
// sample size wherever a percentage appears. Display 'insufficient data' rather than a spurious
// figure." M6.1 (Pipeline metrics) deliberately deferred building this - none of its three metrics
// name a minimum sample, since a currency sum over zero deals is an honest ₦0, not "insufficient
// data" (the same reasoning docs/04-metric-definitions.md's own loss-reason report note already
// gives for a raw count of zero). M6.2's "Stage-to-stage conversion rate" is the first metric in
// this doc that names a real minimum ("20 deals in the denominator"), so this is the first real
// caller - not built ahead of need.
export type MetricResult<T> =
  | { status: "ok"; value: T; sampleSize: number }
  | { status: "insufficient_data"; sampleSize: number; minimumRequired: number };

// `computeValue` is a thunk, not a plain value, so a caller never has to compute an expensive or
// only-meaningful-when-sufficient value (e.g. a ratio that would divide by a near-zero denominator)
// before knowing whether the sample actually clears the bar.
export function withMinimumSample<T>(sampleSize: number, minimumRequired: number, computeValue: () => T): MetricResult<T> {
  if (sampleSize < minimumRequired) {
    return { status: "insufficient_data", sampleSize, minimumRequired };
  }
  return { status: "ok", value: computeValue(), sampleSize };
}

// M6.3 ("Time in stage with median headline"): docs/04-metric-definitions.md's own reasoning for
// choosing the median over the mean as the headline - "consulting cycle times are right-skewed and
// the mean flatters" - is exactly why both are computed here rather than only one; the mean is
// still reported, as secondary, per that same sentence. Neither is defined for an empty input: a
// caller is expected to have already checked sampleSize (typically via withMinimumSample) before
// calling either - a median of zero values is not "zero," it is undefined, and returning 0 would be
// exactly the misleading figure this file's suppression machinery exists to prevent.
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median of an empty array is undefined");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error("mean of an empty array is undefined");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
