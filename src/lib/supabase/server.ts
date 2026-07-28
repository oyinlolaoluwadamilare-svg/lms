import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

// Server Components / Server Actions / Route Handlers only. Uses the anon key plus the caller's
// session cookie, so every query this client makes is subject to RLS as that user - never the
// service_role key, which would bypass it (CLAUDE.md #1).
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // Server Components can't set cookies (no response to attach them to); middleware
          // refreshes the session on every request, so this is safe to swallow here.
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // no-op, see above
          }
        },
      },
    },
  );
}
