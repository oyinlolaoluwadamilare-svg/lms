"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updatePasswordSchema } from "./schema";

export type UpdatePasswordState = { ok: false; message: string } | null;

export async function updatePasswordAction(
  _prevState: UpdatePasswordState,
  formData: FormData,
): Promise<UpdatePasswordState> {
  const parsed = updatePasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // No verified recovery/invite session - the link was already used, expired, or was never
    // followed. Never accept a password change without one.
    redirect("/sign-in?error=link-expired");
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { ok: false, message: "Could not update your password. Try requesting a new link." };
  }

  redirect("/");
}
