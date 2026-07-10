import 'server-only';
import { NextResponse } from 'next/server';
import { isAIConfigured, NOT_CONFIGURED } from './ai';
import { getCurrentUser, type CurrentUser } from './session';
import { getDefaultYear, loadDataset } from './dataset';
import { defaultPeriod } from './engine';
import { parsePeriodParam } from './format';
import type { Dataset, Period, Role } from './types';

interface AiContext {
  user: CurrentUser;
  ds: Dataset;
  period: Period;
  body: Record<string, unknown>;
}

/** Shared shape for every AI route: session guard, graceful not-configured
 *  state, dataset load, then the feature's own prompt. */
export function aiRoute(
  roles: Role[],
  handler: (ctx: AiContext) => Promise<string>,
) {
  return async function POST(request: Request): Promise<NextResponse> {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
    if (!roles.includes(user.role)) {
      return NextResponse.json({ error: 'Not available for your role.' }, { status: 403 });
    }
    if (!isAIConfigured()) return NextResponse.json(NOT_CONFIGURED);

    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      // empty body is fine
    }
    const year = Number(body.year) || (await getDefaultYear());
    const ds = await loadDataset(year);
    if (!ds) return NextResponse.json({ error: `No fiscal year ${year}.` }, { status: 404 });
    const period = parsePeriodParam(
      typeof body.period === 'string' ? body.period : undefined,
      defaultPeriod(ds),
    );

    try {
      const result = await handler({ user, ds, period, body });
      return NextResponse.json({ configured: true, result });
    } catch (err) {
      console.error('AI route failed', err);
      const message =
        err instanceof Error && err.message.includes('access')
          ? err.message
          : 'The assistant could not complete that request. Please try again.';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}

/** Resolve which unit an AI request may talk about: operators are always
 *  scoped to their own unit no matter what the client sent. */
export function scopeUnit(user: CurrentUser, requested: unknown): string | null {
  if (user.role === 'lob') return user.unitId;
  return typeof requested === 'string' && requested ? requested : null;
}
