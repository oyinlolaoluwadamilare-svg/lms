"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { UpdatePasswordForm } from "./UpdatePasswordForm";

type GateState = "checking" | "ready" | "expired";

// The recovery link lands here with the session as URL-fragment tokens (see
// app/(auth)/reset-password/actions.ts for why). Creating the browser client triggers
// @supabase/ssr's detectSessionInUrl, which parses the fragment, establishes the session in
// cookies, and strips it from the URL - PASSWORD_RECOVERY fires once that's done. Only then is it
// safe to show the form; anything else (no fragment, an already-used link) is expired.
export function UpdatePasswordGate() {
  const [state, setState] = useState<GateState>("checking");

  useEffect(() => {
    const supabase = createClient();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setState("ready");
    });

    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setState((current) => (current === "checking" ? "ready" : current));
    });

    const timeout = setTimeout(() => {
      setState((current) => (current === "checking" ? "expired" : current));
    }, 3000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  if (state === "checking") {
    return <p className="text-sm text-muted">Verifying your link…</p>;
  }

  if (state === "expired") {
    return (
      <div className="flex max-w-sm flex-col gap-3 text-center">
        <p role="alert" className="text-sm text-lost">
          This link is invalid or has expired.
        </p>
        <a href="/reset-password" className="text-sm text-accent underline underline-offset-2">
          Request a new reset link
        </a>
      </div>
    );
  }

  return <UpdatePasswordForm />;
}
