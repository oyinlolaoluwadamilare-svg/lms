import { complete } from '@/lib/ai';
import { aiRoute } from '@/lib/ai-route';
import { groupSummary } from '@/lib/summaries';
import { periodLabel } from '@/lib/format';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Board-ready summary of a period across the group for the EMT to edit
 *  and adopt: headline, then risks, then where to focus. */
export const POST = aiRoute(['emt', 'csst'], async ({ ds, period }) => {
  const summary = groupSummary(ds, period);
  return complete({
    system:
      'Write a board-ready executive summary of the period across the whole group. Structure: a one-paragraph headline on group performance; then the material risks, each with the numbers that evidence it; then a short "Where to focus" list of at most four items. Keep it under 350 words. Facts before judgement, and mark recommendations clearly. The EMT will edit before adopting it.',
    prompt: `DATA:\n${summary}\n\nWrite the executive summary for ${periodLabel(period, ds.year)}.`,
    maxTokens: 1200,
  });
});
