import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

/** Optimistic redirect for signed-out visitors. Real authorization happens
 *  server-side in lib/session.ts on every page and action. */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionCookie = getSessionCookie(request);

  if (pathname === '/login') {
    if (sessionCookie) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    return NextResponse.next();
  }

  if (!sessionCookie) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except auth endpoints, static assets, and files
    '/((?!api/auth|_next/static|_next/image|favicon.ico|logos|.*\\.[a-zA-Z0-9]+$).*)',
  ],
};
