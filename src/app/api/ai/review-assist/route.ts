import { complete } from '@/lib/ai';
import { aiRoute } from '@/lib/ai-route';
import { submissionSummary } from '@/lib/summaries';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** For the EMT on a submission: suggested questions to put to the unit and
 *  a rationale for a proposed rating, to make sign-off faster and fairer. */
export const POST = aiRoute(['emt', 'csst'], async ({ ds, body }) => {
  const submissionId = typeof body.submissionId === 'string' ? body.submissionId : '';
  const summary = submissionSummary(ds, submissionId);
  if (!summary) throw new Error('Submission not found.');
  return complete({
    system:
      'You help the Executive Management Team review a submitted period. Produce two sections. First, "Questions for the unit": three to five sharp questions the EMT should put to the MD, each anchored in a specific number or gap in the data, including whether the narrative squares with the numbers. Second, "Rating rationale": propose a rating from 1 to 5 with a two or three sentence justification grounded in attainment, data completeness, and the quality of the narrative and initiatives. The EMT decides; your rating is only a proposal.',
    prompt: `DATA:\n${summary}\n\nWrite the review assistance.`,
  });
});
