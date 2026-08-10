"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { OutcomeReason } from "@/services/outcomeReasons";
import { dateInTimezone } from "@/lib/dates";
import { markDealLostAction } from "./markLostActions";

// M5.3 (docs/07-build-backlog.md): "Mark ... Lost dialogs enforcing" M5.1/M5.2's rules - see
// MarkWonModal.tsx's own comment for why this renders as a plain button rather than "under a menu"
// (docs/06-ui-spec.md's literal text). reasonDetail is always shown and required ("loss requires
// detail" is unconditional on any loss, not merely a competitor-required one). competitorName is
// shown always but only marked required, both visually and by a pre-submit check here, once the
// selected reason's own requiresCompetitorName is true - that is a per-reason runtime fact
// (outcome_reasons.requires_competitor_name, M5.2), not something the schema can express statically;
// closeDeal's own competitor_name_required result code is the authoritative backstop regardless of
// what this dialog does or doesn't catch first.
export function MarkLostModal({
  dealId,
  timezone,
  reasons,
}: {
  dealId: string;
  timezone: string;
  reasons: OutcomeReason[];
}) {
  const router = useRouter();
  const idPrefix = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const reasonRef = useRef<HTMLSelectElement>(null);

  const [reasonId, setReasonId] = useState("");
  const [reasonDetail, setReasonDetail] = useState("");
  const [competitorName, setCompetitorName] = useState("");
  const [actualCloseDate, setActualCloseDate] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedReason = reasons.find((r) => r.id === reasonId) ?? null;

  function today(): string {
    return dateInTimezone(new Date().toISOString(), timezone);
  }

  function openModal() {
    setReasonId(reasons[0]?.id ?? "");
    setReasonDetail("");
    setCompetitorName("");
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
    if (reasonDetail.trim().length === 0) {
      setError("A loss requires a detail explaining why");
      return;
    }
    if (selectedReason?.requiresCompetitorName && competitorName.trim().length === 0) {
      setError("This reason requires a competitor name");
      return;
    }
    setPending(true);
    setError(null);

    const result = await markDealLostAction(dealId, { reasonId, reasonDetail, competitorName, actualCloseDate });

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
        className="rounded-token border border-line px-3 py-1.5 text-sm font-medium text-lost outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent"
      >
        Mark Lost
      </button>

      <dialog
        ref={dialogRef}
        onKeyDown={handleKeyDown}
        className="w-full max-w-md rounded-token border border-line bg-surface p-0 text-ink backdrop:bg-ink/40"
      >
        <form method="dialog" onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-4 p-6">
          <h2 className="text-sm font-semibold text-ink">Mark deal as Lost</h2>

          {reasons.length === 0 ? (
            <p className="text-sm text-muted">No active loss reasons are configured. Ask your tenant admin to add one.</p>
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
            <label htmlFor={`${idPrefix}-reasonDetail`} className="text-sm font-medium text-ink">
              Detail
            </label>
            <textarea
              id={`${idPrefix}-reasonDetail`}
              required
              rows={3}
              value={reasonDetail}
              onChange={(e) => setReasonDetail(e.target.value)}
              className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          {selectedReason?.requiresCompetitorName ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${idPrefix}-competitorName`} className="text-sm font-medium text-ink">
                Competitor name
              </label>
              <input
                id={`${idPrefix}-competitorName`}
                required
                type="text"
                value={competitorName}
                onChange={(e) => setCompetitorName(e.target.value)}
                className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          ) : null}

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
              className="rounded-token bg-lost px-4 py-2 text-sm font-medium text-surface outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
            >
              {pending ? "Saving…" : "Mark as Lost"}
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
