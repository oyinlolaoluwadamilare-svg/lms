import { complete } from '@/lib/ai';
import { aiRoute } from '@/lib/ai-route';
import { groupSummary, unitSummary } from '@/lib/summaries';
import { periodLabel } from '@/lib/format';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** For everyone on Analytics: a short written read on the period. Operators
 *  see their own unit; CSST and EMT see the group. */
export const POST = aiRoute(['csst', 'emt', 'lob'], async ({ user, ds, period }) => {
  const summary =
    user.role === 'lob' && user.unitId
      ? unitSummary(ds, user.unitId, period)
      : groupSummary(ds, period);
  return complete({
    system:
      'Write a short insight on the period: three or four paragraphs at most. Lead with the single most important fact, then what is driving performance up or down, then what deserves attention next. Facts first, then a clearly marked short recommendation section.',
    prompt: `DATA:\n${summary}\n\nWrite the ${periodLabel(period, ds.year)} insight.`,
  });
});
