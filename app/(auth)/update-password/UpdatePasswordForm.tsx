"use client";

import { useActionState } from "react";
import { updatePasswordAction, type UpdatePasswordState } from "./actions";

export function UpdatePasswordForm() {
  const [state, formAction, pending] = useActionState<UpdatePasswordState, FormData>(
    updatePasswordAction,
    null,
  );

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium text-ink">
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirmPassword" className="text-sm font-medium text-ink">
          Confirm new password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
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
        {pending ? "Saving…" : "Save new password"}
      </button>
    </form>
  );
}
