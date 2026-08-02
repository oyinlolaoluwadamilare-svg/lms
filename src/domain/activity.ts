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
