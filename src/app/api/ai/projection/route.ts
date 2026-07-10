import { complete } from '@/lib/ai';
import { aiRoute, scopeUnit } from '@/lib/ai-route';
import { projectionSummary } from '@/lib/summaries';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** From actuals to date, whether each target is in reach by year end, with
 *  the assumption stated. */
export const POST = aiRoute(['csst', 'emt', 'lob'], async ({ user, ds, body }) => {
  const unitId = user.role === 'lob' ? user.unitId : scopeUnit(user, body.unitId);
  const summary = projectionSummary(ds, unitId);
  return complete({
    system:
      'Write a short read on the year-end outlook from the run-rate projections. State the assumption up front in one sentence. Then: which targets are comfortably in reach, which are in reach only if performance improves and by how much, and which are out of reach at the current run rate. Group by unit if more than one unit is present. End with a clearly marked recommendation on where intervention would change the year-end outcome most.',
    prompt: `DATA:\n${summary}\n\nWrite the year-end outlook.`,
  });
});
