import { complete } from '@/lib/ai';
import { aiRoute } from '@/lib/ai-route';
import { definitionSummary } from '@/lib/summaries';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** For CSST on Administration: propose measurable KPIs for a unit from its
 *  objectives, perspectives, and aspiration. */
export const POST = aiRoute(['csst'], async ({ ds, body }) => {
  const unitId = typeof body.unitId === 'string' ? body.unitId : '';
  const summary = definitionSummary(ds, unitId);
  return complete({
    system:
      'You help the Corporate Strategy Support Team design measurable KPIs. Propose 5 to 8 KPIs that are not already on the scorecard. For each, give: name, unit of measure, direction (higher or lower is better), aggregation (sum for flows, average for rates, period end for stocks), a suggested weight, the objective and perspective it belongs under, and one sentence on why it matters. Never suggest summing a rate. A person will review and create the KPIs; nothing you write is saved automatically.',
    prompt: `DATA:\n${summary}\n\nPropose the KPIs.`,
  });
});
