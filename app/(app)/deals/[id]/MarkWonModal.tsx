"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { OutcomeReason } from "@/services/outcomeReasons";
import { dateInTimezone } from "@/lib/dates";
import { markDealWonAction } from "./markWonActions";

// M5.3 (docs/07-build-backlog.md): "Mark Won ... dialogs enforcing" M5.1's outcome-reasons config
// and M5.2's closeDeal rules. docs/06-ui-spec.md's only text on this ("under a menu: Mark Won, Mark
// Lost, Escalate, Add Contact") is deliberately not followed literally: Escalate and Add Contact
// don't exist yet either, and building the app's first dropdown-menu primitive for two buttons
// would be premature abstraction (CLAUDE.md #6) ahead of the third and fourth action actually
// needing it. Rendered as a plain trigger button next to Edit deal instead, the same
// boolean-gated-visibility shape LogActivityModal/AddTaskModal already use.
//
// reasons is always the active-only, win-type list (getActiveOutcomeReasons, src/services/
// outcomeReasons.ts) - an empty list (no active win reasons configured for this tenant) is a real,
// designed state below, not an unhandled edge case: the picker is replaced with a message and the
// submit button is disabled, since "closing is impossible without a reason" (M5.2) means there is
// nothing useful this dialog could submit.
export function MarkWonModal({
  dealId,
  timezone,
  currencyCode,
  reasons,
}: {
  dealId: string;
  timezone: string;
  currencyCode: string;
  reasons: OutcomeReason[];
}) {
  const router = useRouter();
  const idPrefix = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const reasonRef = useRef<HTMLSelectElement>(null);

  const [reasonId, setReasonId] = useState("");
  const [finalValue, setFinalValue] = useState("");
  const [actualCloseDate, setActualCloseDate] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function today(): string {
    return dateInTimezone(new Date().toISOString(), timezone);
  }

  function openModal() {
    setReasonId(reasons[0]?.id ?? "");
    setFinalValue("");
    setActualCloseDate(today());
    setError(null);
    dialogRef.current?.showModal();
    requestAnimationFrame(() => reasonRef.current?.focus());
  }

  async function handleSave() {
    if (pending) return;
    if (!reasonId) {
      setError("Select a reason");
      return;
    }
    setPending(true);
    setError(null);

    const result = await markDealWonAction(dealId, { reasonId, finalValue, actualCloseDate, currencyCode });

    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
    dialogRef.current?.close();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSave();
    }
    if (e.key === "Escape") {
      dialogRef.current?.close();
    }
  }

  const isFutureDate = actualCloseDate > today();

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="rounded-token border border-line px-3 py-1.5 text-sm font-medium text-won outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent"
      >
        Mark Won
      </button>

      <dialog
        ref={dialogRef}
        onKeyDown={handleKeyDown}
        className="w-full max-w-md rounded-token border border-line bg-surface p-0 text-ink backdrop:bg-ink/40"
      >
        <form method="dialog" onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-4 p-6">
          <h2 className="text-sm font-semibold text-ink">Mark deal as Won</h2>

          {reasons.length === 0 ? (
            <p className="text-sm text-muted">No active win reasons are configured. Ask your tenant admin to add one.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${idPrefix}-reason`} className="text-sm font-medium text-ink">
                Reason
              </label>
              <select
                id={`${idPrefix}-reason`}
                ref={reasonRef}
                value={reasonId}
                onChange={(e) => setReasonId(e.target.value)}
                className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
              >
                {reasons.map((reason) => (
                  <option key={reason.id} value={reason.id}>
                    {reason.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${idPrefix}-finalValue`} className="text-sm font-medium text-ink">
              Final value (optional)
            </label>
            <input
              id={`${idPrefix}-finalValue`}
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={finalValue}
              onChange={(e) => setFinalValue(e.target.value)}
              className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${idPrefix}-actualCloseDate`} className="text-sm font-medium text-ink">
              Close date
            </label>
            <input
              id={`${idPrefix}-actualCloseDate`}
              type="date"
              value={actualCloseDate}
              max={today()}
              onChange={(e) => setActualCloseDate(e.target.value)}
              className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
            />
            {isFutureDate ? (
              <p role="alert" className="text-xs text-lost">
                A deal can&apos;t close in the future
              </p>
            ) : null}
          </div>

          {error ? (
            <p role="alert" aria-live="polite" className="text-sm text-lost">
              {error}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={pending || isFutureDate || reasons.length === 0}
              className="rounded-token bg-won px-4 py-2 text-sm font-medium text-surface outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
            >
              {pending ? "Saving…" : "Mark as Won"}
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
