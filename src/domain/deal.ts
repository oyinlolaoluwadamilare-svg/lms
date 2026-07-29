import type { Money } from "@/domain/money";

export interface DealForCalculation {
  proposalValueMinor: bigint | null;
  negotiatedValueMinor: bigint | null;
  currencyCode: string;
  probabilityOverride: number | null;
}

export interface StageForCalculation {
  probabilityThreshold: number;
}

// docs/01-domain-model.md "Derived values" table: "deals.probability | stage probability
// threshold unless explicitly overridden." Never stored as its own column (db/schema.sql has no
// `probability` column, only `probability_override`) - always resolved at read time.
export function resolveProbability(deal: DealForCalculation, stage: StageForCalculation): number {
  return deal.probabilityOverride ?? stage.probabilityThreshold;
}

// docs/04-metric-definitions.md "Open pipeline value": coalesce(negotiated_value_minor,
// proposal_value_minor). Null (not zero) when neither is set yet - "no value entered" is not the
// same fact as "valued at zero," and treating it as zero would silently corrupt any weighted sum
// built on top of this.
export function dealValue(deal: DealForCalculation): Money | null {
  const amountMinor = deal.negotiatedValueMinor ?? deal.proposalValueMinor;
  if (amountMinor === null) return null;
  return { amountMinor, currency: deal.currencyCode };
}

// docs/01-domain-model.md: "weighted_value | value multiplied by probability, computed at query
// time" - never stored. docs/04-metric-definitions.md "Weighted forecast": deal value multiplied
// by probability, where probability is coalesce(probability_override, stage.probability_threshold)
// / 100. bigint arithmetic throughout (CLAUDE.md #9) - division truncates any sub-minor-unit
// remainder toward zero, which is correct: a currency's minor unit is its smallest representable
// amount already.
export function weightedValue(deal: DealForCalculation, stage: StageForCalculation): Money | null {
  const value = dealValue(deal);
  if (!value) return null;
  const probability = resolveProbability(deal, stage);
  return { amountMinor: (value.amountMinor * BigInt(probability)) / 100n, currency: value.currency };
}

// docs/01-domain-model.md lists "reference (short human id)" as a deals field but specifies no
// format anywhere, and it is not a listed open question in docs/DECISIONS.md. This is therefore an
// inferred, low-stakes default rather than a confirmed business decision - flagged here and in the
// commit history rather than silently assumed: a per-tenant sequential "D-" prefix with a
// zero-padded 4-digit number. Revisit if the product owner wants something else (e.g. a
// practice-line-coded prefix, a year component); nothing else in the schema depends on this exact
// format, only on `reference` being unique per (tenant_id, reference) (migration 0005).
export function formatDealReference(sequenceNumber: number): string {
  if (!Number.isInteger(sequenceNumber) || sequenceNumber < 1) {
    throw new Error(`sequenceNumber must be a positive integer, got ${sequenceNumber}`);
  }
  return `D-${String(sequenceNumber).padStart(4, "0")}`;
}
