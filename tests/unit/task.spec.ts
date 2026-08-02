import { describe, expect, it } from "vitest";
import { snoozeReasonRequired, taskQueueGroup, TASK_QUEUE_GROUPS, TASK_QUEUE_GROUP_LABELS } from "@/domain/task";

describe("taskQueueGroup", () => {
  const today = "2026-03-09";

  it("a due date before today is overdue", () => {
    expect(taskQueueGroup("2026-03-08", today)).toBe("overdue");
    expect(taskQueueGroup("2026-01-01", today)).toBe("overdue");
  });

  it("a due date equal to today is due_today", () => {
    expect(taskQueueGroup(today, today)).toBe("due_today");
  });

  it("a due date within the next 6 days is this_week", () => {
    expect(taskQueueGroup("2026-03-10", today)).toBe("this_week");
    expect(taskQueueGroup("2026-03-15", today)).toBe("this_week");
  });

  it("a due date more than 6 days out is later", () => {
    expect(taskQueueGroup("2026-03-16", today)).toBe("later");
    expect(taskQueueGroup("2027-01-01", today)).toBe("later");
  });

  it("a null due date is no_date - structurally unreachable today (due_date is NOT NULL), but the type still covers it", () => {
    expect(taskQueueGroup(null, today)).toBe("no_date");
  });

  it("every group has a label", () => {
    for (const group of TASK_QUEUE_GROUPS) {
      expect(TASK_QUEUE_GROUP_LABELS[group]).toBeTruthy();
    }
  });
});

describe("snoozeReasonRequired", () => {
  it("the first two snoozes need no reason", () => {
    expect(snoozeReasonRequired(0)).toBe(false);
    expect(snoozeReasonRequired(1)).toBe(false);
  });

  it("the third snooze onward requires a reason", () => {
    expect(snoozeReasonRequired(2)).toBe(true);
    expect(snoozeReasonRequired(5)).toBe(true);
  });
});
