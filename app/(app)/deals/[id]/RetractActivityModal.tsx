"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { retractActivityAction } from "./editActivityActions";

// M3.6 (docs/07-build-backlog.md): "retraction by Director or Admin with a mandatory reason." The
// caller (page.tsx) only renders this trigger when canRetractActivity is true and the entry isn't
// already retracted - the same gating LogActivityModal/EditActivityModal's own triggers use, so
// this component doesn't re-check role or retraction state itself.
export function RetractActivityModal({ activityId }: { activityId: string }) {
  const router = useRouter();
  // One instance per retractable entry on the page - a static id would collide across all of them
  // (invalid HTML, unreliable label association), the same bug EditActivityModal's own useId fix
  // addresses, found via the same manual QA pass.
  const idPrefix = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openModal() {
    setReason("");
    setError(null);
    dialogRef.current?.showModal();
    requestAnimationFrame(() => reasonRef.current?.focus());
  }

  async function handleRetract() {
    if (pending) return;
    if (reason.trim().length === 0) {
      setError("A reason is required");
      reasonRef.current?.focus();
      return;
    }
    setPending(true);
    setError(null);

    const result = await retractActivityAction(activityId, reason);

    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    dialogRef.current?.close();
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="text-xs font-medium text-lost underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent"
      >
        Retract
      </button>

      <dialog
        ref={dialogRef}
        className="w-full max-w-md rounded-token border border-line bg-surface p-0 text-ink backdrop:bg-ink/40"
      >
        <form method="dialog" onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-4 p-6">
          <h2 className="text-sm font-semibold text-ink">Retract activity</h2>
          <p className="text-sm text-muted">
            The activity stays visible, struck through with your reason - it is never removed.
          </p>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${idPrefix}-reason`} className="text-sm font-medium text-ink">
              Reason
            </label>
            <textarea
              id={`${idPrefix}-reason`}
              ref={reasonRef}
              required
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          {error ? (
            <p role="alert" aria-live="polite" className="text-sm text-lost">
              {error}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRetract}
              disabled={pending}
              className="rounded-token bg-lost px-4 py-2 text-sm font-medium text-surface outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
            >
              {pending ? "Retracting…" : "Retract activity"}
            </button>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded-token border border-line px-4 py-2 text-sm font-medium text-ink outline-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent"
            >
              Cancel
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
