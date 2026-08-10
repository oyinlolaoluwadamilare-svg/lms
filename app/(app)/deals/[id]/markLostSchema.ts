import { z } from "zod";

// M5.3 (docs/07-build-backlog.md): "Mark ... Lost dialogs enforcing" M5.1/M5.2's rules. reasonDetail
// is required here (unlike markWonSchema, which has no equivalent field) because "loss requires
// detail" is unconditional on any loss, not merely on a competitor-required reason - closeDeal's own
// loss_requires_detail check backs this up server-side regardless. competitorName is NOT required
// here even though some loss reasons require one: which reason requires it is a per-reason,
// runtime fact (outcome_reasons.requires_competitor_name), not something a static schema can
// express - MarkLostModal.tsx enforces it dynamically once a reason is selected, and closeDeal's own
// competitor_name_required result code is the authoritative backstop either way.
export const markLostSchema = z.object({
  reasonId: z.string().uuid("Select a reason"),
  reasonDetail: z.string().trim().min(1, "A loss requires a detail explaining why"),
  competitorName: z.string().trim().optional(),
  actualCloseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid close date"),
});

export type MarkLostFormValues = z.infer<typeof markLostSchema>;
