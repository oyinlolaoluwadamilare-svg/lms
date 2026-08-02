import { z } from "zod";
import { ACTIVITY_TYPES, OUTCOME_DISPOSITIONS } from "@/domain/activity";

// Same field shape as logActivitySchema (M3.4) - editing an activity changes the same fields
// logging one sets, nothing more. activityDate's future-date rejection and the edit-window check
// both happen in src/services/activities.ts's updateActivity; this schema only checks the shape.
export const editActivitySchema = z.object({
  type: z.enum(ACTIVITY_TYPES, { message: "Select an activity type" }),
  activityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid activity date"),
  summary: z.string().trim().min(1, "Summary is required"),
  outcome: z.string().trim().optional(),
  outcomeDisposition: z.enum(OUTCOME_DISPOSITIONS).optional(),
});

export type EditActivityFormValues = z.infer<typeof editActivitySchema>;
