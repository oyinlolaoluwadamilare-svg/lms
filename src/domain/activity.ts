// activities (db/schema.sql / db/migrations/0008_activities). ACTIVITY_TYPES/OUTCOME_DISPOSITIONS
// mirror the Postgres enums exactly - kept as a typed union here so a caller gets a compile error
// for a typo'd type rather than a runtime constraint violation from the database.
export const ACTIVITY_TYPES = [
  "note",
  "call",
  "email",
  "meeting",
  "follow_up",
  "site_visit",
  "proposal_walkthrough",
  "internal_review",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const OUTCOME_DISPOSITIONS = ["positive", "neutral", "negative", "no_response"] as const;
export type OutcomeDisposition = (typeof OUTCOME_DISPOSITIONS)[number];

// Shared display labels - promoted here once a second consumer (M3.5's engagement timeline, and
// its filter dropdown) needed the exact same labels app/(app)/deals/[id]/LogActivityModal.tsx
// (M3.4) first defined locally.
export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  note: "Note",
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  follow_up: "Follow-up",
  site_visit: "Site visit",
  proposal_walkthrough: "Proposal walkthrough",
  internal_review: "Internal review",
};

export const OUTCOME_DISPOSITION_LABELS: Record<OutcomeDisposition, string> = {
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
  no_response: "No response",
};
