"use client";

import { useRef } from "react";
import type { TaskPriority } from "@/domain/task";
import type { AssignableUser } from "@/services/tasks";
import { formatPlainDate } from "@/lib/dates";
import { AddTaskModal, type AddTaskModalHandle } from "./AddTaskModal";

interface NextActionStripProps {
  dealId: string;
  timezone: string;
  actorId?: string;
  canAddTask: boolean;
  assignableUsers: AssignableUser[];
  nextAction: { taskId: string; title: string; dueDate: string; priority: TaskPriority } | null;
}

// docs/06-ui-spec.md's Deal detail header: "a next-action strip showing the next task and its due
// date, or a prominent amber 'No next step - add one' call to action." Backed by migration 0013's
// refresh_deal_next_action() trigger via getDealDetail's own `nextAction` field (M4.4) - null there
// genuinely means "no open task on this deal", not "hasn't been computed yet" (CLAUDE.md #7), so
// this component can render the two states as a plain if/else with no loading state to reconcile.
//
// The CTA opens the identical AddTaskModal the header's own standalone "Add Task" button already
// uses (embedded here with showTrigger=false, the same composition LogActivityModal's "Save and add
// task" already established) - two entry points to the same single creation path, not two different
// features. Hidden entirely (falls back to plain "No next step" text, no button) when the actor
// can't add tasks on this deal - the same boolean-gated-visibility shape every other role-
// conditional action in this codebase already uses.
export function NextActionStrip({ dealId, timezone, actorId, canAddTask, assignableUsers, nextAction }: NextActionStripProps) {
  const addTaskRef = useRef<AddTaskModalHandle>(null);

  if (nextAction) {
    return (
      <span className="text-xs font-medium text-ink">
        Next: {nextAction.title} <span className="text-muted">· due {formatPlainDate(nextAction.dueDate)}</span>
      </span>
    );
  }

  if (!canAddTask || !actorId) {
    return <span className="text-xs font-medium text-risk">No next step</span>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => addTaskRef.current?.open()}
        className="rounded-token bg-risk px-2 py-0.5 text-xs font-semibold text-surface outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        No next step — add one
      </button>
      <AddTaskModal ref={addTaskRef} dealId={dealId} timezone={timezone} actorId={actorId} assignableUsers={assignableUsers} showTrigger={false} />
    </>
  );
}
