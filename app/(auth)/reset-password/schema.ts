import { z } from "zod";

export const requestResetSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
});
