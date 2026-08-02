"use client";

import { forwardRef, useId, useImperativeHandle, useRef, useState } from "react";
import type { TaskCommentsContext } from "@/services/taskComments";
import { addWatcherAction, createTaskCommentAction, getTaskCommentsContextAction, resolveTaskCommentAction } from "./commentActions";

export interface TaskCommentsDialogHandle {
  open: () => void;
}

interface TaskCommentsDialogProps {
  taskId: string;
  taskTitle: string;
  viewerId: string;
}

// M4.9 (docs/07-build-backlog.md): "Comments, watchers and @mention with an in-scope user picker."
// No task-detail page exists anywhere in this codebase (docs/06-ui-spec.md never mentions one) -
// this follows the exact same imperative <dialog>-per-row idiom TaskRow's own Snooze/Reassign
// dialogs and AddTaskModal already established, rather than inventing a new route. @mention is a
// picker (checkboxes over the same in-scope population the assignee picker uses), not free-text
// @handle parsing - src/services/taskComments.ts's own header comment has the full reasoning.
export const TaskCommentsDialog = forwardRef<TaskCommentsDialogHandle, TaskCommentsDialogProps>(function TaskCommentsDialog(
  { taskId, taskTitle, viewerId },
  ref,
) {
  const idPrefix = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [loading, setLoading] = useState(false);
  const [context, setContext] = useState<TaskCommentsContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [body, setBody] = useState("");
  const [mentioned, setMentioned] = useState<Set<string>>(new Set());
  const [posting, setPosting] = useState(false);

  const [addWatcherId, setAddWatcherId] = useState("");
  const [watcherPending, setWatcherPending] = useState(false);

  const [resolvingId, setResolvingId] = useState<string | null>(null);

  async function reload() {
    const result = await getTaskCommentsContextAction(taskId);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setContext(result.context);
    setAddWatcherId(result.context.mentionCandidates[0]?.id ?? "");
  }

  async function openDialog() {
    setError(null);
    setBody("");
    setMentioned(new Set());
    setLoading(true);
    dialogRef.current?.showModal();
    await reload();
    setLoading(false);
  }

  useImperativeHandle(ref, () => ({ open: openDialog }));

  function toggleMention(userId: string) {
    setMentioned((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function handlePostComment() {
    if (posting || body.trim().length === 0) return;
    setPosting(true);
    setError(null);
    const result = await createTaskCommentAction(taskId, { body, mentionedUserIds: [...mentioned] });
    setPosting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setBody("");
    setMentioned(new Set());
    await reload();
  }

  async function handleResolve(commentId: string, resolved: boolean) {
    if (resolvingId) return;
    setResolvingId(commentId);
    setError(null);
    const result = await resolveTaskCommentAction(commentId, resolved);
    setResolvingId(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    await reload();
  }

  async function handleAddWatcher() {
    if (watcherPending || !addWatcherId) return;
    setWatcherPending(true);
    setError(null);
    const result = await addWatcherAction(taskId, addWatcherId);
    setWatcherPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    await reload();
  }

  async function handleWatchSelf() {
    if (watcherPending) return;
    setWatcherPending(true);
    setError(null);
    const result = await addWatcherAction(taskId, viewerId);
    setWatcherPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    await reload();
  }

  return (
    <dialog ref={dialogRef} className="w-full max-w-lg rounded-token border border-line bg-surface p-0 text-ink backdrop:bg-ink/40">
      <form method="dialog" onSubmit={(e) => e.preventDefault()} className="flex max-h-[80vh] flex-col gap-4 overflow-y-auto p-6">
        <h2 className="text-sm font-semibold text-ink">Comments · {taskTitle}</h2>

        {error ? (
          <p role="alert" aria-live="polite" className="text-xs text-lost">
            {error}
          </p>
        ) : null}

        {loading || !context ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <>
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Watchers</h3>
              <ul className="flex flex-wrap gap-1.5">
                {context.watchers.length === 0 ? <li className="text-xs text-muted">No watchers yet.</li> : null}
                {context.watchers.map((watcher) => (
                  <li key={watcher.userId} className="rounded-token bg-raised px-2 py-0.5 text-xs text-ink">
                    {watcher.userId === viewerId ? `${watcher.fullName} (you)` : watcher.fullName}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-2">
                {context.canWatchSelf ? (
                  <button
                    type="button"
                    onClick={handleWatchSelf}
                    disabled={watcherPending}
                    className="rounded-token border border-line px-2.5 py-1 text-xs font-medium text-ink outline-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
                  >
                    Watch this task
                  </button>
                ) : null}
                {context.canAddWatcher && context.mentionCandidates.length > 0 ? (
                  <>
                    <select
                      aria-label="Add a watcher"
                      value={addWatcherId}
                      onChange={(e) => setAddWatcherId(e.target.value)}
                      className="rounded-token border border-line bg-surface px-2 py-1 text-xs text-ink outline-none focus:ring-2 focus:ring-accent"
                    >
                      {context.mentionCandidates.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.fullName}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleAddWatcher}
                      disabled={watcherPending}
                      className="rounded-token border border-line px-2.5 py-1 text-xs font-medium text-ink outline-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
                    >
                      Add watcher
                    </button>
                  </>
                ) : null}
              </div>
            </section>

            <section className="flex flex-col gap-3 border-t border-line pt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Comments</h3>
              {context.comments.length === 0 ? <p className="text-xs text-muted">No comments yet.</p> : null}
              <ol className="flex flex-col gap-2">
                {context.comments.map((comment) => (
                  <li key={comment.id} className="flex flex-col gap-1 rounded-token border border-line bg-raised p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-ink">{comment.authorName}</span>
                      <span className="text-xs text-muted">{new Date(comment.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="text-sm text-ink">{comment.body}</p>
                    <div className="flex items-center gap-2">
                      {comment.resolvedAt ? (
                        <span className="text-xs font-medium text-won">Resolved{comment.resolvedByName ? ` by ${comment.resolvedByName}` : ""}</span>
                      ) : null}
                      {comment.canResolve ? (
                        <button
                          type="button"
                          onClick={() => handleResolve(comment.id, comment.resolvedAt === null)}
                          disabled={resolvingId === comment.id}
                          className="text-xs font-medium text-accent outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
                        >
                          {comment.resolvedAt ? "Mark unresolved" : "Mark resolved"}
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            {context.canComment ? (
              <section className="flex flex-col gap-2 border-t border-line pt-3">
                <label htmlFor={`${idPrefix}-comment-body`} className="text-sm font-medium text-ink">
                  Add a comment
                </label>
                <textarea
                  id={`${idPrefix}-comment-body`}
                  rows={3}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="rounded-token border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
                />
                {context.mentionCandidates.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-ink">Mention</span>
                    <div className="flex flex-wrap gap-2">
                      {context.mentionCandidates.map((user) => (
                        <label key={user.id} className="flex items-center gap-1 text-xs text-ink">
                          <input type="checkbox" checked={mentioned.has(user.id)} onChange={() => toggleMention(user.id)} />
                          {user.fullName}
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div>
                  <button
                    type="button"
                    onClick={handlePostComment}
                    disabled={posting || body.trim().length === 0}
                    className="rounded-token bg-accent px-3 py-1.5 text-xs font-medium text-surface outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
                  >
                    {posting ? "Posting…" : "Post comment"}
                  </button>
                </div>
              </section>
            ) : null}
          </>
        )}

        <div className="flex items-center gap-2 border-t border-line pt-3">
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="rounded-token border border-line px-3 py-1.5 text-xs font-medium text-ink outline-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent"
          >
            Close
          </button>
        </div>
      </form>
    </dialog>
  );
});
