import { complete } from '@/lib/ai';
import { aiRoute, scopeUnit } from '@/lib/ai-route';
import { varianceSummary } from '@/lib/summaries';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Flag KPIs whose movement is unusual against their own history so nothing
 *  important hides inside a green average. */
export const POST = aiRoute(['csst', 'emt', 'lob'], async ({ user, ds, body }) => {
  const unitId = user.role === 'lob' ? user.unitId : scopeUnit(user, body.unitId);
  const summary = varianceSummary(ds, unitId);
  return complete({
    system:
      'You detect variances and anomalies in monthly KPI attainment. Flag movements that are unusual against the KPI\'s own history: sudden spikes or drops of roughly 20 percentage points or more, steady multi-month deterioration, and gaps in reporting. For each flag, say plainly what moved, by how much, and in which months, then one sentence on why it deserves attention. If a strong average hides a bad recent month, call that out. List the flags in order of importance. If nothing is anomalous, say so honestly.',
    prompt: `DATA:\n${summary}\n\nFlag the anomalies.`,
  });
});
