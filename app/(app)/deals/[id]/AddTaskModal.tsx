"use client";

import { forwardRef, useId, useImperativeHandle, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_TASK_PRIORITY, TASK_PRIORITIES, TASK_PRIORITY_LABELS, type TaskPriority } from "@/domain/task";
import type { AssignableUser } from "@/services/tasks";
import { addDaysToPlainDate, dateInTimezone } from "@/lib/dates";
import { addTaskAction } from "./addTaskActions";

export interface AddTaskModalHandle {
  // originActivityId carries "Save and add task" 's context forward (docs/06-ui-spec.md) - set only
  // when opened as a continuation from a just-saved activity, omitted for the standalone "Add Task"
  // button.
  open: (options?: { originActivityId?: string }) => void;
}

interface AddTaskModalProps {
  dealId: string;
  timezone: string;
  actorId: string;
  assignableUsers: AssignableUser[];
  // false when this instance is only ever opened imperatively (LogActivityModal's embedded usage) -
  // showing its own "Add Task" trigger button there too would duplicate the one already on the deal
  // page header.
  showTrigger?: boolean;
}

// docs/06-ui-spec.md's Add Task modal: "Title autofocused, assignee defaulting to self with a
// scope-filtered picker showing avatar, name and role, due date with quick options (today,
// tomorrow, next week, custom), priority defaulting to normal, optional description and linked
// deal. Assigning to someone else surfaces 'They will be notified' so the user knows delegation is
// real." Two things named in the spec are deliberately not built here: an avatar image (no avatar
// system exists anywhere in this codebase yet - the same gap LogActivityModal's own comment already
// flags for a "type icon") and a deal picker (this slice only reaches the modal from within a deal's
// own detail page, so "linked deal" is always this page's own dealId - a deal-less/global "Add Task"
// entry point belongs to M4.5's My Work screen, which doesn't exist yet).
export const AddTaskModal = forwardRef<AddTaskModalHandle, AddTaskModalProps>(function AddTaskModal(
  { dealId, timezone, actorId, assignableUsers, showTrigger = true },
  ref,
) {
  const router = useRouter();
  const idPrefix = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const originActivityIdRef = useRef<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState(actorId);
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<TaskPriority>(DEFAULT_TASK_PRIORITY);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function today(): string {
    return dateInTimezone(new Date().toISOString(), timezone);
  }

  function openModal(options?: { originActivityId?: string }) {
    originActivityIdRef.current = options?.originActivityId ?? null;
    setTitle("");
    setDescription("");
    setAssigneeId(actorId);
    setDueDate(today());
    setPriority(DEFAULT_TASK_PRIORITY);
    setError(null);
    dialogRef.current?.showModal();
    requestAnimationFrame(() => titleRef.current?.focus());
  }

  useImperativeHandle(ref, () => ({ open: openModal }));

  async function handleSave() {
    if (pending) return;
    if (title.trim().length === 0) {
      setError("Title is required");
      titleRef.current?.focus();
      return;
    }
    setPending(true);
    setError(null);

    const result = await addTaskAction(dealId, originActivityIdRef.current, {
      title,
      description,
      assigneeId,
      dueDate,
      priority,
    });

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

  const quickDueDates = [
    { label: "Today", value: today() },
    { label: "Tomorrow", value: addDaysToPlainDate(today(), 1) },
    { label: "Next week", value: addDaysToPlainDate(today(), 7) },
  ];

  return (
    <>
      {showTrigger ? (
        <button
          type="button"
          onClick={() => openModal()}
          className="rounded-token border border-line px-3 py-1.5 text-sm font-medium text-ink outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent"
        >
          Add Task
        </button>
      ) : null}

      <dialog
        ref={dialogRef}
        onKeyDown={handleKeyDown}
        className="w-full max-w-lg rounded-token border border-line bg-surface p-0 text-ink backdrop:bg-ink/40"
      >
        <form method="dialog" onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-4 p-6">
          <h2 className="text-sm font-semibold text-ink">Add Task</h2>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${idPrefix}-title`} className="text-sm font-medium text-ink">
              Title
            </label>
            <input
              id={`${idPrefix}-title`}
              ref={titleRef}
              required
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${idPrefix}-assignee`} className="text-sm font-medium text-ink">
              Assignee
            </label>
            <select
              id={`${idPrefix}-assignee`}
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
            >
              {assignableUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.id === actorId ? `${user.fullName} (you)` : user.fullName} · {user.role.replace("_", " ")}
                </option>
              ))}
            </select>
            {assigneeId !== actorId ? <p className="text-xs text-muted">They will be notified.</p> : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${idPrefix}-dueDate`} className="text-sm font-medium text-ink">
              Due date
            </label>
            <div className="flex flex-wrap gap-1.5">
              {quickDueDates.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => setDueDate(option.value)}
                  aria-pressed={dueDate === option.value}
                  className={`rounded-token border px-2.5 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    dueDate === option.value ? "border-accent bg-accent text-surface" : "border-line bg-raised text-ink"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <input
              id={`${idPrefix}-dueDate`}
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${idPrefix}-priority`} className="text-sm font-medium text-ink">
              Priority
            </label>
            <select
              id={`${idPrefix}-priority`}
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {TASK_PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${idPrefix}-description`} className="text-sm font-medium text-ink">
              Description (optional)
            </label>
            <textarea
              id={`${idPrefix}-description`}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
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
              onClick={handleSave}
              disabled={pending}
              className="rounded-token bg-accent px-4 py-2 text-sm font-medium text-surface outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save task"}
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
});
