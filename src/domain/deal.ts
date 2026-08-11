import type { Money } from "@/domain/money";

// The single source of truth for these unions - db/migrations/0005's enum types, mirrored here so
// every caller (form schema, filters, table columns) shares one definition rather than each
// re-declaring its own "new" | "existing" literal.
export type ClientType = "new" | "existing";
export type DealStatus = "active" | "won" | "lost" | "on_hold";
export type ForecastCategory = "pipeline" | "best_case" | "commit" | "closed";
export type StageType = "open" | "won" | "lost";

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

// docs/04-metric-definitions.md "Value bands" - flagged there, and in docs/DECISIONS.md's D-12, as
// an UNCONFIRMED DEFAULT (asked of the product owner, not yet answered) rather than a settled
// business rule; revisit both docs together if the boundaries change. Defined in NGN minor units
// (kobo) only - decision D-08b (multi-currency/reporting-currency handling) remains open, so a
// value in any other currency has no real meaning against these boundaries yet.
export type ValueBand = "under_5m" | "5m_25m" | "25m_100m" | "100m_plus" | "not_recorded";

export const VALUE_BAND_LABELS: Record<ValueBand, string> = {
  under_5m: "Under ₦5,000,000",
  "5m_25m": "₦5,000,000 – ₦24,999,999",
  "25m_100m": "₦25,000,000 – ₦99,999,999",
  "100m_plus": "₦100,000,000 and above",
  not_recorded: "Value not recorded",
};

// "not_recorded" is its own band, never folded into "under_5m" - the same "null is not zero"
// reasoning dealValue's own comment already gives: a deal nobody ever valued is a different fact
// from a deal valued small, and merging the two would silently misrepresent the first as the second.
export function valueBand(amountMinor: bigint | null): ValueBand {
  if (amountMinor === null) return "not_recorded";
  if (amountMinor < 500_000_000n) return "under_5m";
  if (amountMinor < 2_500_000_000n) return "5m_25m";
  if (amountMinor < 10_000_000_000n) return "25m_100m";
  return "100m_plus";
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

// docs/03-architecture.md names `changeStage` as "the only way a deal's stage changes," but that
// same document makes `closeDeal` (docs/07-build-backlog.md M5.2, src/services/deals.ts) the only path
// that may move a deal into a won/lost stage - it "writes the outcome row, the stage event, the
// deal status... atomically. Cannot succeed without an outcome reason." A plain changeStage cannot
// honour that (there is no outcome-reason mechanism until M5.1's outcome_reasons/deal_outcomes
// land), so it must refuse this transition rather than silently leave a deal sitting in a won/lost
// stage with no outcome, no status change and no closed date - a worse, harder-to-detect defect
// than a rejected drag.
export function isOpenStage(stageType: StageType): boolean {
  return stageType === "open";
}

// docs/04-metric-definitions.md's "Staleness bands": "0-7 days green, 8-21 blue, 22-45 amber, 46 or
// more red." (Thresholds are documented as tenant-configurable; these are the defaults, and nothing
// in this codebase reads a per-tenant override yet - flagged as a known gap, not silently assumed
// to be the only behaviour this will ever need.) "never" is a distinct fifth state for a deal with
// no client-facing activity yet, not folded into the 46+ band - the same doc: "Null last-engaged
// means never engaged... is displayed explicitly as 'never' and is not treated as zero."
export type StalenessBand = "fresh" | "ok" | "warn" | "cold" | "never";

export function stalenessBand(daysSinceLastEngagement: number | null): StalenessBand {
  if (daysSinceLastEngagement === null) return "never";
  if (daysSinceLastEngagement <= 7) return "fresh";
  if (daysSinceLastEngagement <= 21) return "ok";
  if (daysSinceLastEngagement <= 45) return "warn";
  return "cold";
}

// docs/06-ui-spec.md's deal header chip: "Last engaged 12 days ago" ... "or 'Never engaged' in
// red." The day-0 case ("Last engaged today") is a small extrapolation beyond that one example,
// flagged here rather than silently invented as if it were specified.
export function formatLastEngaged(daysSinceLastEngagement: number | null): string {
  if (daysSinceLastEngagement === null) return "Never engaged";
  if (daysSinceLastEngagement === 0) return "Last engaged today";
  return `Last engaged ${daysSinceLastEngagement} ${daysSinceLastEngagement === 1 ? "day" : "days"} ago`;
}

// docs/06-ui-spec.md's Stakeholders section (M5.6): "If fewer than two contacts and the deal is
// past Discovery, show a single-threading warning." ⚠ UNCONFIRMED DEFAULT, not a product-owner
// decision (see docs/DECISIONS.md's D-13) - "Discovery" names no reserved stage code or structural
// concept anywhere in docs/01-domain-model.md; pipeline_stages are fully tenant-configurable
// (migration 0005), and "Discovery" only ever appears in this codebase's own docs as this one
// spec line and its restatement in docs/07-build-backlog.md - it traces back to the external
// benchmark PRD's own illustrative "Discovery Call" example stage, not a tenant-agnostic rule. The
// user was asked directly (past the first open stage vs. a literal name/code match vs. a custom
// rule) and did not answer before work continued; per this session's own precedent for an
// unanswered business-rule question, "past the first open stage" was adopted as the flagged,
// reversible default: sortOrder strictly greater than every tenant's own earliest open-type stage,
// which works for any tenant regardless of how stages are named, added, or reordered.
export function isPastFirstOpenStage(currentStageSortOrder: number, firstOpenStageSortOrder: number): boolean {
  return currentStageSortOrder > firstOpenStageSortOrder;
}

export function showsSingleThreadingWarning(contactCount: number, currentStageSortOrder: number, firstOpenStageSortOrder: number): boolean {
  return contactCount < 2 && isPastFirstOpenStage(currentStageSortOrder, firstOpenStageSortOrder);
}
