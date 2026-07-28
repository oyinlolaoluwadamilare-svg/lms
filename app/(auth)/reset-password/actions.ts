"use server";

import { createClient } from "@/lib/supabase/server";
import { requestResetSchema } from "./schema";

export type RequestResetState = { ok: true } | { ok: false; message: string } | null;

// Supabase's redirectTo must match the project's Auth site_url / URL allow list, or the recovery
// email link silently falls back to site_url instead. Update NEXT_PUBLIC_SITE_URL (and the
// Supabase Auth config) together when a real production domain exists.
//
// Points straight at /update-password rather than a server route: email template customisation
// isn't available on the project's current (free) plan, so the recovery email uses Supabase's
// default template and hosted verify redirect, which lands the session as URL-fragment tokens -
// visible to the browser only, never to a server route. /update-password's client-side gate
// picks them up. Revisit once a paid plan or custom SMTP allows a token_hash-based template, which
// would let this go through a server-verified route instead.
export async function requestResetAction(
  _prevState: RequestResetState,
  formData: FormData,
): Promise<RequestResetState> {
  const parsed = requestResetSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${siteUrl}/update-password`,
  });

  // Same outcome whether or not the address has an account - never confirm or deny that on a
  // public form (NFR: no user-enumeration surface via the password-reset endpoint).
  return { ok: true };
}
