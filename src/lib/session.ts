import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { auth } from './auth';
import { db } from '@/db';
import { profiles } from '@/db/schema';
import type { Role } from './types';

export interface CurrentUser {
  userId: string;
  email: string;
  name: string;
  role: Role;
  unitId: string | null;
}

/** Session plus profile for the request, cached per render pass.
 *  This, not the proxy, is the authorization boundary. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, session.user.id))
    .limit(1);
  if (!profile) return null;
  return {
    userId: session.user.id,
    email: session.user.email,
    name: profile.fullName ?? session.user.name,
    role: profile.role,
    unitId: profile.unitId,
  };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

/** Guard for pages and actions restricted to specific roles. */
export async function requireRole(...roles: Role[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    throw new Error('You do not have access to perform this action.');
  }
  return user;
}

/** Guard for unit-scoped writes: CSST may touch any unit, an operator only
 *  their own. Reviewers do not write unit data. */
export async function requireUnitWrite(unitId: string): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role === 'csst') return user;
  if (user.role === 'lob' && user.unitId === unitId) return user;
  throw new Error('You do not have access to this unit.');
}

/** Resolve the unit an operator action applies to. Operators always act on
 *  their own unit regardless of what the client sent; CSST may pass any. */
export async function resolveActingUnit(requestedUnitId?: string | null): Promise<{
  user: CurrentUser;
  unitId: string;
}> {
  const user = await requireUser();
  if (user.role === 'lob') {
    if (!user.unitId) throw new Error('Your account is not linked to a unit.');
    return { user, unitId: user.unitId };
  }
  if (user.role === 'csst' && requestedUnitId) return { user, unitId: requestedUnitId };
  throw new Error('You do not have access to report for a unit.');
}
