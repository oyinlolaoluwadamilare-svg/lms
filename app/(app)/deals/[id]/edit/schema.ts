import { z } from "zod";

// Mirrors app/(app)/deals/new/schema.ts's shape for the fields they share - deliberately no
// accountId/practiceLineId/stageId/ownerId here: those aren't editable through this form (see
// src/data/deals.ts's DealForEdit comment for exactly why each one is out of scope).
export const editDealSchema = z.object({
  name: z.string().trim().min(1, "Deal name is required"),
  clientType: z.enum(["new", "existing"], { message: "Select new or existing client" }),
  expectedCloseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid expected close date"),
  proposalValue: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || /^\d+(\.\d{1,2})?$/.test(value), {
      message: "Enter a valid proposal value (up to 2 decimal places)",
    }),
  negotiatedValue: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || /^\d+(\.\d{1,2})?$/.test(value), {
      message: "Enter a valid negotiated value (up to 2 decimal places)",
    }),
  brief: z.string().trim().optional(),
});

export type EditDealFormValues = z.infer<typeof editDealSchema>;
