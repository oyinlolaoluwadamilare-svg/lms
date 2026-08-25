import { z } from "zod";

// M5.9 (docs/07-build-backlog.md): "Handover panel... shown on owner change." Only shape
// validation lives here - the actual business rules (the new owner must be a real, same-tenant
// user eligible in this practice line) are src/services/accounts.ts's own
// reassignAccountPracticeOwner job, the same "schema checks shape, service checks business rules"
// split every other xxxSchema.ts in this codebase already follows.
export const reassignOwnerSchema = z.object({
  practiceLineId: z.string().uuid(),
  newOwnerId: z.string().uuid("Select a new owner"),
});

export type ReassignOwnerFormValues = z.infer<typeof reassignOwnerSchema>;
