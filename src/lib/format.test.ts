import { describe, expect, it } from 'vitest';
import {
  formatAttainment,
  formatNaira,
  formatValue,
  parsePeriodParam,
  periodLabel,
  periodToParam,
  ragLabel,
} from './format';

describe('formatNaira', () => {
  it('compacts large values', () => {
    expect(formatNaira(1_200_000_000)).toBe('N1.2bn');
    expect(formatNaira(850_000_000)).toBe('N850.0m');
    expect(formatNaira(45_000)).toBe('N45,000');
  });
});

describe('formatValue', () => {
  it('scales Naira UOMs stored in millions', () => {
    expect(formatValue(120, 'NGN m')).toBe('N120.0m');
    expect(formatValue(1200, 'NGN m')).toBe('N1.2bn');
  });
  it('formats percentages, days and counts', () => {
    expect(formatValue(91.25, '%')).toBe('91.3%');
    expect(formatValue(42, 'days')).toBe('42 days');
    expect(formatValue(18, 'count')).toBe('18');
  });
  it('labels missing values honestly', () => {
    expect(formatValue(null, '%')).toBe('No data');
  });
});

describe('periods', () => {
  it('round-trips period params', () => {
    const fallback = { kind: 'year', index: 1 } as const;
    for (const p of [
      { kind: 'month', index: 6 } as const,
      { kind: 'quarter', index: 2 } as const,
      { kind: 'half', index: 1 } as const,
      { kind: 'year', index: 1 } as const,
    ]) {
      expect(parsePeriodParam(periodToParam(p), fallback)).toEqual(p);
    }
  });
  it('rejects nonsense params with the fallback', () => {
    const fallback = { kind: 'quarter', index: 2 } as const;
    expect(parsePeriodParam('m13', fallback)).toEqual(fallback);
    expect(parsePeriodParam('q5', fallback)).toEqual(fallback);
    expect(parsePeriodParam('banana', fallback)).toEqual(fallback);
    expect(parsePeriodParam(undefined, fallback)).toEqual(fallback);
  });
  it('labels periods', () => {
    expect(periodLabel({ kind: 'quarter', index: 2 }, 2026)).toBe('Q2 2026');
    expect(periodLabel({ kind: 'month', index: 6 }, 2026)).toBe('Jun 2026');
  });
});

describe('labels', () => {
  it('pairs RAG with words, never colour alone', () => {
    expect(ragLabel('green')).toBe('On track');
    expect(ragLabel('amber')).toBe('At risk');
    expect(ragLabel('red')).toBe('Off track');
    expect(ragLabel('none')).toBe('No data');
  });
  it('formats attainment', () => {
    expect(formatAttainment(101.4)).toBe('101%');
    expect(formatAttainment(null)).toBe('Not scored');
  });
});
