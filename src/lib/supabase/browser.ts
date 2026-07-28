import { createBrowserClient } from "@supabase/ssr";

// Client Components only. @supabase/ssr stores the session in cookies (not localStorage), so a
// session this client detects or establishes is also visible to Server Components/Actions on the
// next request - used for the password-recovery landing page, which must parse the implicit-flow
// token out of the URL fragment in the browser (the project's email templates aren't customisable
// on the free tier, so the recovery link uses Supabase's default template and hosted verify
// redirect rather than a server-readable token_hash; the fragment never reaches the server).
//
// process.env.NEXT_PUBLIC_* must appear as a literal dot-access here, not behind a helper - the
// client bundler only statically inlines that exact pattern; a dynamic process.env[name] lookup
// (as used server-side in server.ts, where real process.env exists at runtime) silently resolves
// to undefined in the browser.
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required");
  if (!anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is required");
  return createBrowserClient(url, anonKey);
}
