import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// POST-only (never GET) so a prefetch or a stray link can't sign a user out by accident.
export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
