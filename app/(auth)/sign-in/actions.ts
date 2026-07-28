"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/services/session";
import { signInSchema } from "./schema";

export type SignInState = { ok: false; message: string } | null;

function safeNextPath(value: FormDataEntryValue | null): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/";
}

// The single path for sign-in. A wrong email/password and an unknown email return the exact same
// message - never reveal whether an address has an account (NFR: no user enumeration surface).
export async function signInAction(_prevState: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { ok: false, message: "Incorrect email or password." };
  }

  const session = await getSessionUser(supabase);
  if (session.status !== "active") {
    redirect("/account-suspended");
  }

  redirect(safeNextPath(formData.get("next")));
}
