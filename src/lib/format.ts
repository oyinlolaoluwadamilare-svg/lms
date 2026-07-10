import type { Period, PeriodKind, Rag } from './types';

export const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function monthName(month: number): string {
  return MONTHS[month - 1] ?? '';
}

/** Compact Naira: N850.0m, N1.2bn, N45,000. */
export function formatNaira(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}N${(abs / 1_000_000_000).toFixed(1)}bn`;
  if (abs >= 1_000_000) return `${sign}N${(abs / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `${sign}N${Math.round(abs).toLocaleString('en-NG')}`;
  return `${sign}N${abs.toLocaleString('en-NG', { maximumFractionDigits: 1 })}`;
}

function isNairaUom(uom: string): boolean {
  const u = uom.toLowerCase();
  return u.includes('ngn') || u.includes('naira') || u === 'n';
}

/** Format a KPI value according to its unit of measure. Values for Naira
 *  UOMs are stored in the UOM's own scale (a KPI measured in "NGN m" stores
 *  120 for N120m). */
export function formatValue(value: number | null, uom: string): string {
  if (value === null) return 'No data';
  const u = uom.toLowerCase();
  if (isNairaUom(u)) {
    const scale = u.includes(' m') || u.endsWith('m') ? 1_000_000 : u.includes('bn') ? 1_000_000_000 : 1;
    return formatNaira(value * scale);
  }
  if (u === '%' || u.includes('percent')) return `${round1(value)}%`;
  if (u.includes('day')) return `${round1(value)} days`;
  return `${round1(value).toLocaleString('en-NG')}${u === 'count' || u === '' ? '' : ` ${uom}`}`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function formatAttainment(pct: number | null): string {
  if (pct === null) return 'Not scored';
  return `${Math.round(pct)}%`;
}

export function ragLabel(rag: Rag): string {
  switch (rag) {
    case 'green':
      return 'On track';
    case 'amber':
      return 'At risk';
    case 'red':
      return 'Off track';
    default:
      return 'No data';
  }
}

export function periodLabel(period: Period, year?: number): string {
  const suffix = year ? ` ${year}` : '';
  switch (period.kind) {
    case 'month':
      return `${monthName(period.index)}${suffix}`;
    case 'quarter':
      return `Q${period.index}${suffix}`;
    case 'half':
      return `H${period.index}${suffix}`;
    case 'year':
      return `FY${suffix || ' full year'}`;
  }
}

/** URL form of a period: m6, q2, h1, year. */
export function periodToParam(period: Period): string {
  switch (period.kind) {
    case 'month':
      return `m${period.index}`;
    case 'quarter':
      return `q${period.index}`;
    case 'half':
      return `h${period.index}`;
    case 'year':
      return 'year';
  }
}

export function parsePeriodParam(param: string | undefined | null, fallback: Period): Period {
  if (!param) return fallback;
  if (param === 'year') return { kind: 'year', index: 1 };
  const m = /^([mqh])(\d{1,2})$/.exec(param);
  if (!m) return fallback;
  const kinds: Record<string, PeriodKind> = { m: 'month', q: 'quarter', h: 'half' };
  const kind = kinds[m[1]];
  const index = Number(m[2]);
  const max = kind === 'month' ? 12 : kind === 'quarter' ? 4 : 2;
  if (index < 1 || index > max) return fallback;
  return { kind, index };
}

export function submissionStatusLabel(status: string): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'submitted':
      return 'Submitted';
    case 'approved':
      return 'Signed off';
    case 'returned':
      return 'Returned';
    default:
      return status;
  }
}

export function initiativeStatusLabel(status: string): string {
  switch (status) {
    case 'not_started':
      return 'Not started';
    case 'in_progress':
      return 'In progress';
    case 'done':
      return 'Done';
    case 'blocked':
      return 'Blocked';
    default:
      return status;
  }
}

export function formatDate(iso: string | Date | null): string {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}
