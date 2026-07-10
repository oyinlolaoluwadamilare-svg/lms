import 'server-only';
import { defaultPeriod } from './engine';
import { parsePeriodParam } from './format';
import { getDefaultYear, listFiscalYears, loadDataset } from './dataset';
import type { Dataset, Period, Submission } from './types';

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

export interface PeriodContext {
  ds: Dataset | null;
  year: number;
  period: Period;
  years: number[];
}

/** Resolve ?year= and ?period= into a loaded Dataset and a Period, with the
 *  latest reported quarter as the default view. */
export async function resolvePeriodContext(searchParams: SearchParams): Promise<PeriodContext> {
  const sp = await searchParams;
  const yearRows = await listFiscalYears();
  const years = yearRows.map((y) => y.year);
  const fallbackYear = await getDefaultYear();
  const requested = Number(first(sp.year));
  const year = years.includes(requested) ? requested : fallbackYear;
  const ds = await loadDataset(year);
  const period = parsePeriodParam(
    first(sp.period),
    ds ? defaultPeriod(ds) : { kind: 'year', index: 1 },
  );
  return { ds, year, period, years };
}

/** The submission that matches a unit and period exactly. */
export function submissionFor(ds: Dataset, unitId: string, period: Period): Submission | null {
  return (
    ds.submissions.find(
      (s) =>
        s.unitId === unitId && s.periodKind === period.kind && s.periodIndex === period.index,
    ) ?? null
  );
}
