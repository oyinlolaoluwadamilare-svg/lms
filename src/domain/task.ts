import { addDaysToPlainDate } from "@/lib/dates";

// tasks (db/migrations/0011_tasks). TASK_STATUSES/TASK_PRIORITIES mirror the Postgres enums
// exactly, the same reasoning src/domain/activity.ts's ACTIVITY_TYPES already gives.
export const TASK_STATUSES = ["open", "in_progress", "blocked", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const DEFAULT_TASK_PRIORITY: TaskPriority = "normal";

// docs/06-ui-spec.md's My Work screen: "Grouped as Overdue (red, collapsed only if empty), Due
// today, This week, Later, and No date."
export const TASK_QUEUE_GROUPS = ["overdue", "due_today", "this_week", "later", "no_date"] as const;
export type TaskQueueGroup = (typeof TASK_QUEUE_GROUPS)[number];

export const TASK_QUEUE_GROUP_LABELS: Record<TaskQueueGroup, string> = {
  overdue: "Overdue",
  due_today: "Due today",
  this_week: "This week",
  later: "Later",
  no_date: "No date",
};

// "This week" has no precise boundary documented anywhere in docs/ - interpreted here as a rolling
// 7-day window starting today (today itself is already its own "Due today" bucket, so this covers
// tomorrow through six days out), the same kind of undocumented-cutoff judgment call
// src/domain/deal.ts's stalenessBand bands already made for their own day thresholds, flagged here
// rather than silently presented as a documented rule.
//
// dueDate is always non-null in this codebase today - tasks.due_date is NOT NULL (migration 0011's
// own M4.1 decision, following docs/01-domain-model.md literally over docs/06-ui-spec.md's "No
// date" bucket implication). "no_date" is included in the type and this function's signature anyway
// so the shape matches the UI spec's own five buckets - it is structurally unreachable today, the
// same narrower-than-spec-UI shape that M4.1 decision already committed this codebase to, not a
// new gap invented here.
export function taskQueueGroup(dueDate: string | null, today: string): TaskQueueGroup {
  if (dueDate === null) return "no_date";
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "due_today";
  if (dueDate <= addDaysToPlainDate(today, 6)) return "this_week";
  return "later";
}

// docs/06-ui-spec.md: "snooze with reason after two snoozes" - the first two snoozes (snoozeCount
// 0 and 1, i.e. this would become the 1st or 2nd snooze) need no reason; the third snooze onward
// does. A pure predicate so both the service layer (the real enforcement) and the UI (deciding
// whether to show the reason field at all) share one definition rather than two copies of "2".
export function snoozeReasonRequired(currentSnoozeCount: number): boolean {
  return currentSnoozeCount >= 2;
}
