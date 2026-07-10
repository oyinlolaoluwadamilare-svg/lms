import { complete } from '@/lib/ai';
import { aiRoute, scopeUnit } from '@/lib/ai-route';
import { unitSummary } from '@/lib/summaries';
import { periodLabel } from '@/lib/format';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Draft the reporting narrative for a period from the unit's own numbers,
 *  as an editable starting point. Removes the blank-page problem. */
export const POST = aiRoute(['lob', 'csst'], async ({ user, ds, period, body }) => {
  const unitId = scopeUnit(user, body.unitId);
  if (!unitId) throw new Error('You do not have access to a unit.');
  const summary = unitSummary(ds, unitId, period);
  return complete({
    system:
      'Draft the reporting narrative a unit managing director would attach when submitting this period for executive review. One tight paragraph of 4 to 7 sentences, first person plural ("we"). Cover: the headline result, what drove it, what went wrong or is at risk with honest numbers, and what the unit is doing about it, referencing existing initiatives where they exist. No greetings, no headers, no bullet points. The MD will edit before submitting.',
    prompt: `DATA:\n${summary}\n\nDraft the ${periodLabel(period, ds.year)} narrative.`,
    maxTokens: 800,
  });
});
