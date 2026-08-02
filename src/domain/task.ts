// tasks (db/migrations/0011_tasks). TASK_STATUSES/TASK_PRIORITIES mirror the Postgres enums
// exactly, the same reasoning src/domain/activity.ts's ACTIVITY_TYPES already gives.
export const TASK_STATUSES = ["open", "in_progress", "blocked", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
