import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/services/session";

// Middleware already keeps an unauthenticated request off this route, but the app-level
// suspended/inactive check (invariant #1: server-side authorisation always, never UI-only) only
// happens here, where the real session is resolved - see src/services/session.ts.
export default async function Home() {
  const supabase = await createClient();
  const session = await getSessionUser(supabase);

  if (session.status === "signed-out") redirect("/sign-in");
  if (session.status === "suspended") redirect("/account-suspended");

  const { user } = session;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <p className="text-ink">
        Signed in as <span className="font-medium">{user.fullName}</span> ({user.email})
      </p>
      <p className="text-sm text-muted">
        Pipeline Intelligence — scaffold (M0.3: auth). No product features yet.
      </p>
      <form action="/sign-out" method="post">
        <button
          type="submit"
          className="rounded-token border border-line px-4 py-2 text-sm font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
