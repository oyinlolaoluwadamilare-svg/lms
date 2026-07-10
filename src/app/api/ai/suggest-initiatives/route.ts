import { complete } from '@/lib/ai';
import { aiRoute, scopeUnit } from '@/lib/ai-route';
import { unitSummary } from '@/lib/summaries';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** For the operator on Report Actuals: read the at-risk and off-track KPIs
 *  and propose practical corrective initiatives. */
export const POST = aiRoute(['lob', 'csst'], async ({ user, ds, period, body }) => {
  const unitId = scopeUnit(user, body.unitId);
  if (!unitId) throw new Error('You do not have access to a unit.');
  const summary = unitSummary(ds, unitId, period);
  return complete({
    system:
      'You help a unit managing director respond to underperforming KPIs. Focus on the KPIs that are at risk or off track. For each, propose one or two practical corrective initiatives a Nigerian business unit could start this quarter: a clear title, a sensible owner role, a due date horizon, and one sentence on the expected effect. If existing initiatives already cover a KPI, say so instead of duplicating them. The MD decides what to adopt; nothing is saved automatically.',
    prompt: `DATA:\n${summary}\n\nPropose corrective initiatives.`,
  });
});
