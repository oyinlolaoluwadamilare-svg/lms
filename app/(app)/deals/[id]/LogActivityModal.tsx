"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_LABELS,
  OUTCOME_DISPOSITIONS,
  OUTCOME_DISPOSITION_LABELS,
  type ActivityType,
  type OutcomeDisposition,
} from "@/domain/activity";
import { dateInTimezone } from "@/lib/dates";
import { logActivityAction } from "./logActivityActions";

const DEFAULT_TYPE: ActivityType = "call";

// docs/06-ui-spec.md: "Log Activity modal - the three-interaction constraint... Reachable by one
// click from the deal page, and by keyboard shortcut... Path to a saved activity: open modal, type
// summary, save. Three interactions." No specific key is named in the docs for the shortcut - "l"
// (mnemonic for "Log") is this component's own choice, flagged here rather than silently invented
// as if it were specified. Only fires when the modal is closed and focus isn't already in a text
// input, so it never hijacks normal typing elsewhere on the page.
//
// Deliberately missing, per docs/06-ui-spec.md's own field list, but not buildable yet: the
// "contacts present" optional field (contacts don't exist until M5.5) and the secondary "Save and
// add task" button (Add Task modal is M4). Building either now would show a control with nothing
// real behind it - the same reasoning every other narrower-than-spec vertical slice this session
// has taken. "Attachments" (M3.8) is built - a plain multi-file input alongside outcome/disposition
// in the same collapsed-by-default section.
export function LogActivityModal({ dealId, timezone }: { dealId: string; timezone: string }) {
  const router = useRouter();
  // Renders twice on the same page when the timeline is empty (header button + empty-state
  // button, app/(app)/deals/[id]/page.tsx) - a static id would collide across both instances
  // (invalid HTML, unreliable label association), the same bug EditActivityModal/
  // RetractActivityModal's own useId fix addresses (M3.6 QA).
  const idPrefix = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const summaryRef = useRef<HTMLTextAreaElement>(null);

  const [type, setType] = useState<ActivityType>(DEFAULT_TYPE);
  const [activityDate, setActivityDate] = useState("");
  const [summary, setSummary] = useState("");
  const [outcome, setOutcome] = useState("");
  const [outcomeDisposition, setOutcomeDisposition] = useState<OutcomeDisposition | "">("");
  const [files, setFiles] = useState<File[]>([]);
  const [showOptional, setShowOptional] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function today(): string {
    return dateInTimezone(new Date().toISOString(), timezone);
  }

  function openModal() {
    setType(DEFAULT_TYPE);
    setActivityDate(today());
    setSummary("");
    setOutcome("");
    setOutcomeDisposition("");
    setFiles([]);
    setShowOptional(false);
    setError(null);
    dialogRef.current?.showModal();
    // Autofocus the summary field (docs/06-ui-spec.md) - queued after the dialog paints so the
    // browser's own native dialog-open focus handling doesn't immediately steal it back.
    requestAnimationFrame(() => summaryRef.current?.focus());
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (dialogRef.current?.open) return;
      const target = e.target as HTMLElement | null;
      const isTyping = target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (isTyping || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === "l") {
        e.preventDefault();
        openModal();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    if (pending) return;
    if (summary.trim().length === 0) {
      setError("Summary is required");
      summaryRef.current?.focus();
      return;
    }
    setPending(true);
    setError(null);

    const result = await logActivityAction(
      dealId,
      {
        type,
        activityDate,
        summary,
        outcome,
        outcomeDisposition,
      },
      files,
    );

    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
    if (result.attachmentWarning) {
      // The activity itself already saved successfully - keep the modal open just long enough to
      // show which attachment(s) didn't make it, rather than closing over a silent partial
      // failure the user would only discover later on the timeline.
      setError(result.attachmentWarning);
      return;
    }
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

  const isFutureDate = activityDate > today();

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="rounded-token bg-accent px-4 py-2 text-sm font-medium text-surface outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Log Activity
      </button>

      <dialog
        ref={dialogRef}
        onKeyDown={handleKeyDown}
        className="w-full max-w-lg rounded-token border border-line bg-surface p-0 text-ink backdrop:bg-ink/40"
      >
        <form
          method="dialog"
          onSubmit={(e) => e.preventDefault()}
          className="flex flex-col gap-4 p-6"
        >
          <h2 className="text-sm font-semibold text-ink">Log Activity</h2>

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
              max={today()}
              onChange={(e) => setActivityDate(e.target.value)}
              className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
            />
            {isFutureDate ? (
              <p role="alert" className="text-xs text-lost">
                future intent is a task, not an engagement
              </p>
            ) : null}
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

          {showOptional ? (
            <>
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
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${idPrefix}-attachments`} className="text-sm font-medium text-ink">
                  Attachments (optional)
                </label>
                <input
                  id={`${idPrefix}-attachments`}
                  type="file"
                  multiple
                  onChange={(e) => setFiles(e.target.files ? Array.from(e.target.files) : [])}
                  className="text-sm text-ink file:mr-3 file:rounded-token file:border file:border-line file:bg-raised file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-ink"
                />
                <p className="text-xs text-muted">PDF, Word, Excel, PowerPoint, PNG or JPG — up to 10 MB each.</p>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setShowOptional(true)}
              className="self-start text-xs font-medium text-accent underline-offset-2 hover:underline"
            >
              Add outcome, disposition and attachments
            </button>
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
              disabled={pending || isFutureDate}
              className="rounded-token bg-accent px-4 py-2 text-sm font-medium text-surface outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save activity"}
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
