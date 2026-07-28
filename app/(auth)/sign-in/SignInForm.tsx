"use client";

import { useActionState } from "react";
import { signInAction, type SignInState } from "./actions";

export function SignInForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<SignInState, FormData>(signInAction, null);

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next} />

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

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium text-ink">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
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
        {pending ? "Signing in…" : "Sign in"}
      </button>

      <a href="/reset-password" className="text-sm text-muted underline underline-offset-2">
        Forgot your password?
      </a>
    </form>
  );
}
