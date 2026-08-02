"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_LABELS,
  OUTCOME_DISPOSITIONS,
  OUTCOME_DISPOSITION_LABELS,
  type ActivityType,
  type OutcomeDisposition,
} from "@/domain/activity";
import { editActivityAction } from "./editActivityActions";

export interface EditableActivity {
  id: string;
  type: ActivityType;
  activityDate: string;
  summary: string;
  outcome: string | null;
  outcomeDisposition: OutcomeDisposition | null;
}

// M3.6 (docs/07-build-backlog.md): "Edit within the 24-hour window." Mirrors LogActivityModal's
// shape (M3.4) - same field set, same native <dialog>, same plain-arguments server action - but
// pre-filled from the entry being edited rather than defaulted, and there's no keyboard shortcut
// or three-interaction constraint (docs/06-ui-spec.md's "l" shortcut and three-interaction path are
// specified for Log Activity only). The caller (page.tsx) only renders this trigger for entries the
// current actor authored, that aren't retracted, and whose edit_locked_at hasn't passed - so this
// component doesn't re-check any of that itself, the same as LogActivityModal's own trigger button
// only appearing when canLogActivity is true.
export function EditActivityModal({ activity }: { activity: EditableActivity }) {
  const router = useRouter();
  // The timeline renders one of these per eligible entry, so a static id would collide across
  // every instance on the page (invalid HTML, unreliable label association) - found via manual QA
  // against a fixture with many activities. useId() gives each instance its own unique prefix.
  const idPrefix = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const summaryRef = useRef<HTMLTextAreaElement>(null);

  const [type, setType] = useState<ActivityType>(activity.type);
  const [activityDate, setActivityDate] = useState(activity.activityDate);
  const [summary, setSummary] = useState(activity.summary);
  const [outcome, setOutcome] = useState(activity.outcome ?? "");
  const [outcomeDisposition, setOutcomeDisposition] = useState<OutcomeDisposition | "">(activity.outcomeDisposition ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openModal() {
    setType(activity.type);
    setActivityDate(activity.activityDate);
    setSummary(activity.summary);
    setOutcome(activity.outcome ?? "");
    setOutcomeDisposition(activity.outcomeDisposition ?? "");
    setError(null);
    dialogRef.current?.showModal();
    requestAnimationFrame(() => summaryRef.current?.focus());
  }

  async function handleSave() {
    if (pending) return;
    if (summary.trim().length === 0) {
      setError("Summary is required");
      summaryRef.current?.focus();
      return;
    }
    setPending(true);
    setError(null);

    const result = await editActivityAction(activity.id, { type, activityDate, summary, outcome, outcomeDisposition });

    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    dialogRef.current?.close();
    router.refresh();
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

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="text-xs font-medium text-accent underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent"
      >
        Edit
      </button>

      <dialog
        ref={dialogRef}
        onKeyDown={handleKeyDown}
        className="w-full max-w-lg rounded-token border border-line bg-surface p-0 text-ink backdrop:bg-ink/40"
      >
        <form method="dialog" onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-4 p-6">
          <h2 className="text-sm font-semibold text-ink">Edit activity</h2>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium text-ink">Type</legend>
            <div className="flex flex-wrap gap-1.5">
              {ACTIVITY_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  aria-pressed={type === t}
                  className={`rounded-token border px-2.5 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    type === t ? "border-accent bg-accent text-surface" : "border-line bg-raised text-ink"
                  }`}
                >
                  {ACTIVITY_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${idPrefix}-activityDate`} className="text-sm font-medium text-ink">
              Activity date
            </label>
            <input
              id={`${idPrefix}-activityDate`}
              type="date"
              value={activityDate}
              onChange={(e) => setActivityDate(e.target.value)}
              className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${idPrefix}-summary`} className="text-sm font-medium text-ink">
              Summary
            </label>
            <textarea
              id={`${idPrefix}-summary`}
              ref={summaryRef}
              required
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${idPrefix}-outcome`} className="text-sm font-medium text-ink">
              Outcome (optional)
            </label>
            <input
              id={`${idPrefix}-outcome`}
              type="text"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${idPrefix}-outcomeDisposition`} className="text-sm font-medium text-ink">
              Disposition (optional)
            </label>
            <select
              id={`${idPrefix}-outcomeDisposition`}
              value={outcomeDisposition}
              onChange={(e) => setOutcomeDisposition(e.target.value as OutcomeDisposition | "")}
              className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">—</option>
              {OUTCOME_DISPOSITIONS.map((d) => (
                <option key={d} value={d}>
                  {OUTCOME_DISPOSITION_LABELS[d]}
                </option>
              ))}
            </select>
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
              disabled={pending}
              className="rounded-token bg-accent px-4 py-2 text-sm font-medium text-surface outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save changes"}
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
