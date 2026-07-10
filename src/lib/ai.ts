import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

/** The only file that knows which AI provider we use. Everything else calls
 *  complete() with a system framing and a grounded DATA block. */

export function isAIConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const MODEL = () => process.env.AI_MODEL ?? 'claude-sonnet-5';

/** Non-negotiables for every CPMS AI feature, enforced at the prompt level
 *  and defensively post-processed. */
const PREAMBLE = `You are the performance analyst inside Workforce Group's Corporate Performance Management System. Workforce Group is a Nigerian human-capital and consulting firm; money is in Naira.

Rules you must never break:
- Ground every number in the DATA block provided. Never invent, estimate, or extrapolate figures that are not derivable from it.
- Separate fact from recommendation. State what the data says first, then, clearly marked, what you suggest.
- Write plainly for a senior, time-poor Nigerian business audience.
- Do not use em dashes anywhere in your output. Use commas, colons, or full stops instead.
- You see unit-level aggregates only. Never speculate about individual staff.`;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export async function complete(options: {
  system: string;
  prompt: string;
  maxTokens?: number;
}): Promise<string> {
  const response = await getClient().messages.create({
    model: MODEL(),
    max_tokens: options.maxTokens ?? 1500,
    system: `${PREAMBLE}\n\n${options.system}`,
    messages: [{ role: 'user', content: options.prompt }],
  });
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  // House rule, enforced defensively: no em dashes in anything we render.
  return text.replaceAll('—', ', ').replaceAll(' , ', ', ');
}

/** Uniform route-handler helper: the configured=false shape every panel
 *  understands. */
export const NOT_CONFIGURED = {
  configured: false as const,
  message: 'AI assistance is not configured. Set ANTHROPIC_API_KEY to enable it.',
};
