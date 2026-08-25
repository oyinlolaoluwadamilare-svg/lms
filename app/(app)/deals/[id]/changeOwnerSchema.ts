import { z } from "zod";

// M5.9 (docs/07-build-backlog.md): "Handover panel... shown on owner change." Only shape
// validation lives here - the actual business rules (the new owner must be a real, same-tenant
// user eligible in this deal's own practice) are src/services/deals.ts's own changeDealOwner job,
// the same "schema checks shape, service checks business rules" split every other xxxSchema.ts in
// this directory already follows.
export const changeOwnerSchema = z.object({
  newOwnerId: z.string().uuid("Select a new owner"),
});

export type ChangeOwnerFormValues = z.infer<typeof changeOwnerSchema>;
