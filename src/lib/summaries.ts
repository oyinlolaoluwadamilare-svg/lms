import 'server-only';
import {
  activeKpisForUnit,
  attainment,
  groupScore,
  kpiResult,
  latestReportedMonth,
  missingEntries,
  monthsInPeriod,
  runRateProjection,
  statusCounts,
  unitScore,
} from './engine';
import {
  formatAttainment,
  formatValue,
  initiativeStatusLabel,
  monthName,
  periodLabel,
  ragLabel,
  submissionStatusLabel,
} from './format';
import type { Dataset, Kpi, Period } from './types';

/** Compact, engine-computed text blocks that ground every AI feature.
 *  These render engine output, never raw tables and never staff records. */

function kpiLine(ds: Dataset, kpi: Kpi, period: Period): string {
  const r = kpiResult(ds, kpi, period);
  return [
    `- ${kpi.name} (${kpi.uom}, ${kpi.direction === 'lower' ? 'lower is better' : 'higher is better'}, ${kpi.aggregation}, weight ${kpi.weight})`,
    `target ${formatValue(r.target, kpi.uom)}, actual ${formatValue(r.actual, kpi.uom)},`,
    `attainment ${formatAttainment(r.attainment)}, status ${ragLabel(r.rag)},`,
    `${r.monthsReported}/${monthsInPeriod(period).length} months reported`,
  ].join(' ');
}

export function unitSummary(ds: Dataset, unitId: string, period: Period): string {
  const unit = ds.units.find((u) => u.id === unitId);
  if (!unit) return 'Unknown unit.';
  const score = unitScore(ds, unitId, period);
  const aspiration = ds.aspirations.find((a) => a.unitId === unitId);
  const kpis = activeKpisForUnit(ds, unitId);
  const missing = missingEntries(ds, unitId, period);
  const initiatives = ds.initiatives.filter((i) => i.unitId === unitId);

  const lines = [
    `UNIT: ${unit.name} (${unit.type}), ${periodLabel(period, ds.year)}`,
    aspiration ? `Aspiration: ${aspiration.text}` : '',
    `Unit score: ${formatAttainment(score.score)} (${ragLabel(score.rag)})`,
    'KPIs:',
    ...kpis.map((k) => kpiLine(ds, k, period)),
  ];
  if (missing.length > 0) {
    lines.push(
      'Missing data: ' +
        missing
          .map((m) => {
            const kpi = kpis.find((k) => k.id === m.kpiId);
            return `${kpi?.name}: ${m.months.map((mm) => monthName(mm)).join(', ')}`;
          })
          .join('; '),
    );
  }
  if (initiatives.length > 0) {
    lines.push(
      'Initiatives: ' +
        initiatives
          .map((i) => {
            const kpi = ds.kpis.find((k) => k.id === i.kpiId);
            return `${i.title} (${initiativeStatusLabel(i.status)}, owner ${i.owner}${kpi ? `, KPI ${kpi.name}` : ''})`;
          })
          .join('; '),
    );
  }
  return lines.filter(Boolean).join('\n');
}

export function groupSummary(ds: Dataset, period: Period): string {
  const group = groupScore(ds, period);
  const counts = statusCounts(ds, period);
  const lines = [
    `GROUP, ${periodLabel(period, ds.year)}`,
    `Group score: ${formatAttainment(group.score)} (${ragLabel(group.rag)})`,
    `KPI status counts: ${counts.onTrack} on track, ${counts.atRisk} at risk, ${counts.offTrack} off track, ${counts.noData} without data`,
    'Units (weighted):',
    ...group.unitScores.map((us) => {
      const unit = ds.units.find((u) => u.id === us.unitId);
      return `- ${unit?.name} (weight ${unit?.weight}): ${formatAttainment(us.score)} (${ragLabel(us.rag)})`;
    }),
  ];
  for (const unit of ds.units.filter((u) => u.active)) {
    lines.push('', unitSummary(ds, unit.id, period));
  }
  return lines.join('\n');
}

/** Month-by-month attainment movements per KPI, for anomaly detection. */
export function varianceSummary(ds: Dataset, unitId?: string | null): string {
  const latest = latestReportedMonth(ds);
  const units = ds.units.filter((u) => u.active && (!unitId || u.id === unitId));
  const lines: string[] = [`MONTHLY ATTAINMENT BY KPI, Jan to ${monthName(latest)} ${ds.year}`];
  for (const unit of units) {
    lines.push(`Unit: ${unit.name}`);
    for (const kpi of activeKpisForUnit(ds, unit.id)) {
      if (kpi.cadence !== 'continuous') continue;
      const monthly: string[] = [];
      for (let m = 1; m <= latest; m++) {
        const value = ds.monthlyActuals[kpi.id]?.[m - 1]?.value ?? null;
        const target = ds.monthlyTargets[kpi.id]?.[m - 1] ?? null;
        const att = attainment(value, target, kpi.direction);
        monthly.push(`${monthName(m)} ${att === null ? 'no data' : `${Math.round(att)}%`}`);
      }
      lines.push(`- ${kpi.name} (${kpi.uom}): ${monthly.join(', ')}`);
    }
  }
  return lines.join('\n');
}

export function projectionSummary(ds: Dataset, unitId?: string | null): string {
  const units = ds.units.filter((u) => u.active && (!unitId || u.id === unitId));
  const lines: string[] = [
    `RUN-RATE PROJECTIONS TO YEAR END ${ds.year} (assumption: sums continue at the average reported month, rates hold their mean, levels hold their latest value)`,
  ];
  for (const unit of units) {
    lines.push(`Unit: ${unit.name}`);
    for (const kpi of activeKpisForUnit(ds, unit.id)) {
      const p = runRateProjection(ds, kpi);
      lines.push(
        `- ${kpi.name}: year to date ${formatValue(p.ytdActual, kpi.uom)} over ${p.monthsReported} months, projected year end ${formatValue(p.projection, kpi.uom)} against annual target ${formatValue(p.annualTarget, kpi.uom)}, projected attainment ${formatAttainment(p.projectedAttainment)} (${ragLabel(p.rag)})`,
      );
    }
  }
  return lines.join('\n');
}

export function submissionSummary(ds: Dataset, submissionId: string): string | null {
  const submission = ds.submissions.find((s) => s.id === submissionId);
  if (!submission) return null;
  const period: Period = { kind: submission.periodKind, index: submission.periodIndex };
  const lines = [
    unitSummary(ds, submission.unitId, period),
    '',
    `Submission status: ${submissionStatusLabel(submission.status)}`,
    submission.narrative ? `Unit narrative: ${submission.narrative}` : 'No narrative provided.',
  ];
  const history = ds.submissions.filter(
    (s) => s.unitId === submission.unitId && s.id !== submissionId && s.status !== 'draft',
  );
  if (history.length > 0) {
    lines.push(
      'Prior periods: ' +
        history
          .map(
            (s) =>
              `${periodLabel({ kind: s.periodKind, index: s.periodIndex }, ds.year)}: ${submissionStatusLabel(s.status)}${s.rating ? `, rated ${s.rating}/5` : ''}`,
          )
          .join('; '),
    );
  }
  return lines.join('\n');
}

/** Definition context for suggesting KPIs: objectives and existing measures,
 *  no performance data needed. */
export function definitionSummary(ds: Dataset, unitId: string): string {
  const unit = ds.units.find((u) => u.id === unitId);
  if (!unit) return 'Unknown unit.';
  const aspiration = ds.aspirations.find((a) => a.unitId === unitId);
  const objectives = ds.objectives.filter((o) => o.unitId === unitId);
  const groupObjectives = ds.objectives.filter((o) => o.kind === 'group');
  const existing = activeKpisForUnit(ds, unitId);
  return [
    `UNIT: ${unit.name} (${unit.type})`,
    aspiration ? `Aspiration: ${aspiration.text}` : '',
    'Group objectives: ' + groupObjectives.map((o) => o.title).join('; '),
    'Unit objectives: ' +
      objectives
        .map((o) => {
          const perspective = ds.perspectives.find((p) => p.id === o.perspectiveId);
          return `${o.title} (${o.framework}${perspective ? `, ${perspective.name}` : ''})`;
        })
        .join('; '),
    'Perspectives available: ' + ds.perspectives.map((p) => p.name).join('; '),
    'Existing KPIs: ' +
      (existing.length > 0
        ? existing.map((k) => `${k.name} (${k.uom}, ${k.aggregation})`).join('; ')
        : 'none yet'),
  ]
    .filter(Boolean)
    .join('\n');
}
