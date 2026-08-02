// stage_events (db/schema.sql / db/migrations/0007_stage_events). duration_in_previous_seconds
// and is_regression are never supplied by a caller - migration 0007's before-insert trigger
// computes both transactionally (CLAUDE.md #7), the same way audit_entries' occurred_at and
// deals' updated_at/updated_by are database-authoritative, not application-authoritative.
export interface StageEventInput {
  tenantId: string;
  dealId: string;
  fromStageId: string | null;
  toStageId: string;
  actorId: string | null;
}

export interface StageEvent {
  id: string;
  tenantId: string;
  dealId: string;
  fromStageId: string | null;
  toStageId: string;
  actorId: string | null;
  occurredAt: string;
  durationInPreviousSeconds: number | null;
  isReconstructed: boolean;
  isRegression: boolean;
}
