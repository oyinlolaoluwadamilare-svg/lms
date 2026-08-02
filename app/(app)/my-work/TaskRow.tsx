"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TASK_PRIORITY_LABELS, snoozeReasonRequired } from "@/domain/task";
import type { AssignableUser, TaskQueueItem } from "@/services/tasks";
import { addDaysToPlainDate, dateInTimezone, formatPlainDate } from "@/lib/dates";
import { completeTaskAction, getReassignContextAction, reassignTaskAction, snoozeTaskAction } from "./taskActions";

interface TaskRowProps {
  task: TaskQueueItem;
  viewerId: string;
  timezone: string;
  showAssignee: boolean;
}

// docs/06-ui-spec.md's My Work screen: "Each row: priority indicator, title, deal and client,
// assignee if not self, due date. Inline actions: complete, snooze with reason after two snoozes,
// reassign, open deal." One client component per row (not one dialog shared across the whole page)
// so each row's snooze/reassign state is independent - the picker for a Reassign dialog on one row
// must never leak into another row's, and every row can belong to a different deal/practice.
export function TaskRow({ task, viewerId, timezone, showAssignee }: TaskRowProps) {
  const router = useRouter();
  const idPrefix = useId();

  const [completing, setCompleting] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const snoozeDialogRef = useRef<HTMLDialogElement>(null);
  const [snoozeDueDate, setSnoozeDueDate] = useState("");
  const [snoozeReason, setSnoozeReason] = useState("");
  const [snoozePending, setSnoozePending] = useState(false);
  const [snoozeError, setSnoozeError] = useState<string | null>(null);

  const reassignDialogRef = useRef<HTMLDialogElement>(null);
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const [reassignTo, setReassignTo] = useState("");
  const [reassignLoading, setReassignLoading] = useState(false);
  const [reassignPending, setReassignPending] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);

  function today(): string {
    return dateInTimezone(new Date().toISOString(), timezone);
  }

  async function handleComplete() {
    if (completing) return;
    setCompleting(true);
    setRowError(null);
    const result = await completeTaskAction(task.id);
    setCompleting(false);
    if (!result.ok) {
      setRowError(result.message);
      return;
    }
    router.refresh();
  }

  function openSnooze() {
    setSnoozeDueDate(addDaysToPlainDate(today(), 1));
    setSnoozeReason("");
    setSnoozeError(null);
    snoozeDialogRef.current?.showModal();
  }

  async function handleSnooze() {
    if (snoozePending) return;
    const reasonNeeded = snoozeReasonRequired(task.snoozeCount);
    if (reasonNeeded && snoozeReason.trim().length === 0) {
      setSnoozeError("A reason is required after two snoozes");
      return;
    }
    setSnoozePending(true);
    setSnoozeError(null);
    const result = await snoozeTaskAction(task.id, { newDueDate: snoozeDueDate, reason: snoozeReason });
    setSnoozePending(false);
    if (!result.ok) {
      setSnoozeError(result.message);
      return;
    }
    router.refresh();
    snoozeDialogRef.current?.close();
  }

  async function openReassign() {
    setReassignError(null);
    setReassignLoading(true);
    reassignDialogRef.current?.showModal();
    const result = await getReassignContextAction(task.id);
    setReassignLoading(false);
    if (!result.ok) {
      setReassignError(result.message);
      return;
    }
    setAssignableUsers(result.assignableUsers);
    setReassignTo(result.assignableUsers.find((u) => u.id !== task.assigneeId)?.id ?? task.assigneeId);
  }

  async function handleReassign() {
    if (reassignPending) return;
    setReassignPending(true);
    setReassignError(null);
    const result = await reassignTaskAction(task.id, reassignTo);
    setReassignPending(false);
    if (!result.ok) {
      setReassignError(result.message);
      return;
    }
    router.refresh();
    reassignDialogRef.current?.close();
  }

  const isOverdue = task.dueDate < today();

  return (
    <li className="flex flex-col gap-1.5 border-t border-line pt-2 text-sm first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-token bg-raised px-1.5 py-0.5 text-xs font-medium text-muted">{TASK_PRIORITY_LABELS[task.priority]}</span>
        <span className="font-medium text-ink">{task.title}</span>
        {task.dealId ? (
          <Link href={`/deals/${task.dealId}`} prefetch={false} className="text-xs text-accent underline-offset-2 hover:underline">
            {task.dealName} {task.accountName ? `(${task.accountName})` : ""}
          </Link>
        ) : (
          <span className="text-xs text-muted">No deal</span>
        )}
        {showAssignee && task.assigneeId !== viewerId ? <span className="text-xs text-muted">Assigned to {task.assigneeName}</span> : null}
        <span className={`text-xs font-medium ${isOverdue ? "text-lost" : "text-muted"}`}>due {formatPlainDate(task.dueDate)}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleComplete}
          disabled={completing}
          className="rounded-token border border-line px-2.5 py-1 text-xs font-medium text-ink outline-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
        >
          {completing ? "Completing…" : "Complete"}
        </button>
        <button
          type="button"
          onClick={openSnooze}
          className="rounded-token border border-line px-2.5 py-1 text-xs font-medium text-ink outline-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent"
        >
          Snooze
        </button>
        <button
          type="button"
          onClick={openReassign}
          className="rounded-token border border-line px-2.5 py-1 text-xs font-medium text-ink outline-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent"
        >
          Reassign
        </button>
        {task.dealId ? (
          <Link
            href={`/deals/${task.dealId}`}
            prefetch={false}
            className="rounded-token border border-line px-2.5 py-1 text-xs font-medium text-ink outline-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent"
          >
            Open deal
          </Link>
        ) : null}
      </div>

      {rowError ? (
        <p role="alert" aria-live="polite" className="text-xs text-lost">
          {rowError}
        </p>
      ) : null}

      <dialog ref={snoozeDialogRef} className="w-full max-w-sm rounded-token border border-line bg-surface p-0 text-ink backdrop:bg-ink/40">
        <form method="dialog" onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-3 p-6">
          <h2 className="text-sm font-semibold text-ink">Snooze “{task.title}”</h2>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${idPrefix}-snooze-date`} className="text-sm font-medium text-ink">
              New due date
            </label>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setSnoozeDueDate(addDaysToPlainDate(today(), 1))}
                className="rounded-token border border-line bg-raised px-2.5 py-1 text-xs font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Tomorrow
              </button>
              <button
                type="button"
                onClick={() => setSnoozeDueDate(addDaysToPlainDate(today(), 7))}
                className="rounded-token border border-line bg-raised px-2.5 py-1 text-xs font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Next week
              </button>
            </div>
            <input
              id={`${idPrefix}-snooze-date`}
              type="date"
              value={snoozeDueDate}
              onChange={(e) => setSnoozeDueDate(e.target.value)}
              className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          {snoozeReasonRequired(task.snoozeCount) ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${idPrefix}-snooze-reason`} className="text-sm font-medium text-ink">
                Reason (required after two snoozes)
              </label>
              <textarea
                id={`${idPrefix}-snooze-reason`}
                rows={2}
                value={snoozeReason}
                onChange={(e) => setSnoozeReason(e.target.value)}
                className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          ) : null}

          {snoozeError ? (
            <p role="alert" aria-live="polite" className="text-xs text-lost">
              {snoozeError}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSnooze}
              disabled={snoozePending}
              className="rounded-token bg-accent px-3 py-1.5 text-xs font-medium text-surface outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
            >
              {snoozePending ? "Saving…" : "Snooze"}
            </button>
            <button
              type="button"
              onClick={() => snoozeDialogRef.current?.close()}
              className="rounded-token border border-line px-3 py-1.5 text-xs font-medium text-ink outline-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent"
            >
              Cancel
            </button>
          </div>
        </form>
      </dialog>

      <dialog ref={reassignDialogRef} className="w-full max-w-sm rounded-token border border-line bg-surface p-0 text-ink backdrop:bg-ink/40">
        <form method="dialog" onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-3 p-6">
          <h2 className="text-sm font-semibold text-ink">Reassign “{task.title}”</h2>

          {reassignLoading ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${idPrefix}-reassign-to`} className="text-sm font-medium text-ink">
                New assignee
              </label>
              <select
                id={`${idPrefix}-reassign-to`}
                value={reassignTo}
                onChange={(e) => setReassignTo(e.target.value)}
                className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
              >
                {assignableUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.id === viewerId ? `${user.fullName} (you)` : user.fullName} · {user.role.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
          )}

          {reassignError ? (
            <p role="alert" aria-live="polite" className="text-xs text-lost">
              {reassignError}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReassign}
              disabled={reassignPending || reassignLoading}
              className="rounded-token bg-accent px-3 py-1.5 text-xs font-medium text-surface outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
            >
              {reassignPending ? "Saving…" : "Reassign"}
            </button>
            <button
              type="button"
              onClick={() => reassignDialogRef.current?.close()}
              className="rounded-token border border-line px-3 py-1.5 text-xs font-medium text-ink outline-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent"
            >
              Cancel
            </button>
          </div>
        </form>
      </dialog>
    </li>
  );
}
