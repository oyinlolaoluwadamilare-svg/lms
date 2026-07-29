import { z } from "zod";

// docs/07-build-backlog.md M1.3: "requiring owner and expected close date" - both required here,
// matching migration 0005's active_deal_requires_owner_and_date constraint, checked earlier and
// with a clearer message than a raw database error. There is deliberately no `authorId` field
// anywhere in this schema - the server action always uses the signed-in actor, never a value from
// the request (see src/services/deals.ts).
export const createDealSchema = z.object({
  name: z.string().trim().min(1, "Deal name is required"),
  accountId: z.string().uuid("Select an account"),
  practiceLineId: z.string().uuid("Select a practice line"),
  stageId: z.string().uuid("Select a stage"),
  clientType: z.enum(["new", "existing"], { message: "Select new or existing client" }),
  ownerId: z.string().uuid("Select an owner"),
  expectedCloseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid expected close date"),
  proposalValue: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || /^\d+(\.\d{1,2})?$/.test(value), {
      message: "Enter a valid amount (up to 2 decimal places)",
    }),
  brief: z.string().trim().optional(),
});

export type CreateDealFormValues = z.infer<typeof createDealSchema>;
