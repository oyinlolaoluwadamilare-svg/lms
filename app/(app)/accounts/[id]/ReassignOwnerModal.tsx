"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AssignableUser } from "@/services/accounts";
import type { HandoverSummary } from "@/services/handover";
import { HandoverPanel } from "../../deals/[id]/HandoverPanel";
import { reassignAccountPracticeOwnerAction } from "./reassignOwnerActions";

// M5.9 (docs/07-build-backlog.md): "Handover panel... shown on owner change." Mirrors
// app/(app)/deals/[id]/ChangeOwnerModal.tsx's exact two-step shape (pick a new owner, then show the
// handover summary) and reuses its own HandoverPanel component directly - a practice-line
// relationship's handover is the same kind of moment as a deal's, just scoped to every deal the
// account has in this one practice line instead of a single deal (src/services/accounts.ts's own
// reassignAccountPracticeOwner comment explains why). Rendered per practice-line-owner row on the
// Account 360 header, not once for the whole account - a team_lead/director's own grant is
// practice-scoped, so they may see this trigger on one row and not another for the very same
// account.
export function ReassignOwnerModal({
  accountId,
  practiceLineId,
  practiceLineName,
  timezone,
  assignableOwners,
}: {
  accountId: string;
  practiceLineId: string;
  practiceLineName: string;
  timezone: string;
  assignableOwners: AssignableUser[];
}) {
  const router = useRouter();
  const idPrefix = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const ownerRef = useRef<HTMLSelectElement>(null);

  const [newOwnerId, setNewOwnerId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handover, setHandover] = useState<HandoverSummary | null>(null);

  function openModal() {
    setNewOwnerId(assignableOwners[0]?.id ?? "");
    setError(null);
    setHandover(null);
    dialogRef.current?.showModal();
    requestAnimationFrame(() => ownerRef.current?.focus());
  }

  function closeModal() {
    dialogRef.current?.close();
    if (handover) router.refresh();
  }

  async function handleSave() {
    if (pending) return;
    if (!newOwnerId) {
      setError("Select a new owner");
      return;
    }
    setPending(true);
    setError(null);

    const result = await reassignAccountPracticeOwnerAction(accountId, { practiceLineId, newOwnerId });

    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setHandover(result.handover);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !handover) {
      e.preventDefault();
      void handleSave();
    }
    if (e.key === "Escape") {
      closeModal();
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="text-xs font-medium text-accent underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent"
      >
        Reassign
      </button>

      <dialog
        ref={dialogRef}
        onKeyDown={handleKeyDown}
        className="w-full max-w-lg rounded-token border border-line bg-surface p-0 text-ink backdrop:bg-ink/40"
      >
        <form method="dialog" onSubmit={(e) => e.preventDefault()} className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto p-6">
          {handover ? (
            <>
              <h2 className="text-sm font-semibold text-ink">Owner changed - handover summary</h2>
              <HandoverPanel summary={handover} timezone={timezone} />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-token bg-accent px-4 py-2 text-sm font-medium text-surface outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-sm font-semibold text-ink">Reassign {practiceLineName} owner</h2>

              {assignableOwners.length === 0 ? (
                <p className="text-sm text-muted">No other eligible owner is available in this practice line.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`${idPrefix}-newOwnerId`} className="text-sm font-medium text-ink">
                    New owner
                  </label>
                  <select
                    id={`${idPrefix}-newOwnerId`}
                    ref={ownerRef}
                    value={newOwnerId}
                    onChange={(e) => setNewOwnerId(e.target.value)}
                    className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
                  >
                    {assignableOwners.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.fullName}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {error ? (
                <p role="alert" aria-live="polite" className="text-sm text-lost">
                  {error}
                </p>
              ) : null}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={pending || assignableOwners.length === 0}
                  className="rounded-token bg-accent px-4 py-2 text-sm font-medium text-surface outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
                >
                  {pending ? "Saving…" : "Reassign"}
                </button>
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-token border border-line px-4 py-2 text-sm font-medium text-ink outline-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </form>
      </dialog>
    </>
  );
}
