import { z } from "zod";
import { TASK_PRIORITIES } from "@/domain/task";

// docs/06-ui-spec.md's Add Task modal: "Title autofocused ... due date with quick options ...
// priority defaulting to normal, optional description and linked deal." Title, assignee and due
// date are the only mandatory fields - description is optional text, priority always has a value
// (the UI itself defaults it, so this schema just validates whatever was selected).
export const addTaskSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().trim().optional(),
  assigneeId: z.string().uuid("Choose an assignee"),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid due date"),
  priority: z.enum(TASK_PRIORITIES),
});

export type AddTaskFormValues = z.infer<typeof addTaskSchema>;
