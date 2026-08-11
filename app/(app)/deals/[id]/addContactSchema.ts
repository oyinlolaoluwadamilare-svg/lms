import { z } from "zod";
import { DECISION_ROLES } from "@/domain/contact";

// M5.6 (docs/07-build-backlog.md): "Contact management on the deal." Only shape validation lives
// here - the actual business rules (the picked/created contact must belong to the deal's own
// account, the deal must be linkable at all) are src/services/contacts.ts's linkContactToDeal's own
// job, the same "schema checks shape, service checks business rules" split every other xxxSchema.ts
// in this directory already follows.
//
// A discriminated union on mode, not one flat optional-everything object - "existing" and "new" are
// genuinely different shapes (a picked id vs. a full name/title/contact-detail set), and a flat
// object would let a submission mix fields from both modes with no shape-level way to reject that.
const decisionRoleSchema = z.enum(DECISION_ROLES);

const existingContactSchema = z.object({
  mode: z.literal("existing"),
  contactId: z.string().uuid("Select a contact"),
  decisionRole: decisionRoleSchema,
});

const newContactSchema = z.object({
  mode: z.literal("new"),
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().optional(),
  jobTitle: z.string().trim().optional(),
  email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
  phone: z.string().trim().optional(),
  linkedinUrl: z.string().trim().url("Enter a valid URL").optional().or(z.literal("")),
  decisionRole: decisionRoleSchema,
});

export const addContactSchema = z.discriminatedUnion("mode", [existingContactSchema, newContactSchema]);

export type AddContactFormValues = z.infer<typeof addContactSchema>;
