// db/migrations/0018's own decision_role enum, mirrored here the same way src/domain/deal.ts
// mirrors migration 0005's enums - the single source of truth for this union, shared by the
// service layer and (once M5.6 builds it) any form/picker.
export const DECISION_ROLES = [
  "champion",
  "economic_buyer",
  "influencer",
  "technical_evaluator",
  "procurement",
  "blocker",
  "unknown",
] as const;
export type DecisionRole = (typeof DECISION_ROLES)[number];

export const DECISION_ROLE_LABELS: Record<DecisionRole, string> = {
  champion: "Champion",
  economic_buyer: "Economic buyer",
  influencer: "Influencer",
  technical_evaluator: "Technical evaluator",
  procurement: "Procurement",
  blocker: "Blocker",
  unknown: "Unknown",
};
