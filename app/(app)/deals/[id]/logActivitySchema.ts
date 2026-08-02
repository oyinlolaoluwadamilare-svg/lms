import { z } from "zod";
import { ACTIVITY_TYPES, OUTCOME_DISPOSITIONS } from "@/domain/activity";

// docs/06-ui-spec.md's Log Activity modal: Type, Activity date and Summary are the only fields
// shown by default (outcome/disposition are collapsed-by-default optional fields) - summary is
// "the only mandatory text." activityDate's future-date rejection happens in
// src/services/activities.ts's logActivity (the actor's own timezone matters there); this schema
// only checks the shape.
export const logActivitySchema = z.object({
  type: z.enum(ACTIVITY_TYPES, { message: "Select an activity type" }),
  activityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid activity date"),
  summary: z.string().trim().min(1, "Summary is required"),
  outcome: z.string().trim().optional(),
  outcomeDisposition: z.enum(OUTCOME_DISPOSITIONS).optional(),
});

export type LogActivityFormValues = z.infer<typeof logActivitySchema>;
