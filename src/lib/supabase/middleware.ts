import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const PUBLIC_PATHS = ["/sign-in", "/reset-password", "/update-password", "/account-suspended"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// Refreshes the Supabase session cookie on every request and redirects based on auth state.
// Uses auth.getUser() (revalidates against Supabase Auth), never getSession() (trusts the cookie
// as-is) - see https://supabase.com/docs/guides/auth/server-side/nextjs.
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublicPath(pathname)) {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(signInUrl);
  }

  if (user && pathname === "/sign-in") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}
