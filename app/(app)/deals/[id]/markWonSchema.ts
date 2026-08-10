import { z } from "zod";

// M5.3 (docs/07-build-backlog.md): "Mark Won ... dialogs enforcing" M5.1/M5.2's rules. Only shape
// validation lives here - the actual business rules (reason must belong to this tenant and be a
// win reason, the deal mustn't already be closed) are src/services/deals.ts's closeDeal's own job,
// the same "schema checks shape, service checks business rules" split logActivitySchema's own
// comment already establishes. finalValue is optional (closeDeal's own finalValueMinor is
// `bigint | null`) - nothing in docs/01-domain-model.md or docs/06-ui-spec.md requires a won deal
// to record a final value at close time.
export const markWonSchema = z.object({
  reasonId: z.string().uuid("Select a reason"),
  finalValue: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || /^\d+(\.\d{1,2})?$/.test(value), {
      message: "Enter a valid final value (up to 2 decimal places)",
    }),
  actualCloseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid close date"),
});

export type MarkWonFormValues = z.infer<typeof markWonSchema>;
