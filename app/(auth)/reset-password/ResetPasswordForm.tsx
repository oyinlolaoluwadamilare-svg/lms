"use client";

import { useActionState } from "react";
import { requestResetAction, type RequestResetState } from "./actions";

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState<RequestResetState, FormData>(
    requestResetAction,
    null,
  );

  if (state?.ok === true) {
    return (
      <p role="status" aria-live="polite" className="max-w-sm text-sm text-ink">
        If an account exists for that email, we&apos;ve sent a link to reset your password.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium text-ink">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      {state?.ok === false ? (
        <p role="alert" aria-live="polite" className="text-sm text-lost">
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-token bg-accent px-4 py-2 font-medium text-surface outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send reset link"}
      </button>

      <a href="/sign-in" className="text-sm text-muted underline underline-offset-2">
        Back to sign in
      </a>
    </form>
  );
}
