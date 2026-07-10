import { complete } from '@/lib/ai';
import { aiRoute } from '@/lib/ai-route';
import { groupSummary, unitSummary } from '@/lib/summaries';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Ask the data: natural-language questions answered only from the computed
 *  dataset. Operators can only interrogate their own unit. */
export const POST = aiRoute(['csst', 'emt', 'lob'], async ({ user, ds, period, body }) => {
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) throw new Error('Ask a question first.');
  const summary =
    user.role === 'lob' && user.unitId
      ? unitSummary(ds, user.unitId, period)
      : groupSummary(ds, period);
  return complete({
    system:
      'Answer the question strictly from the DATA block. If the answer is not derivable from it, say plainly that the data does not cover it; never guess. Show the figures behind your answer. Keep it short: a direct answer first, then the supporting numbers.',
    prompt: `DATA:\n${summary}\n\nQUESTION: ${question}`,
  });
});
