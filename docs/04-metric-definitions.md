# 04 — Metric Definitions

**Claude Code: never invent a metric formula. If a metric you need is not defined here, stop and ask.**

Every metric below states its formula, its data source, its exclusions and its minimum sample size.
Where sample size is not met, the interface displays "insufficient data", never a misleading zero or
a percentage computed from two records. Reconstructed stage events (`is_reconstructed = true`) are
migration artefacts and are excluded from every duration-based metric. Demo rows (`is_demo = true`)
are excluded from everything.

## Pipeline metrics

**Open pipeline value.** Sum of `coalesce(negotiated_value_minor, proposal_value_minor)` for deals
with `status = 'active'`, converted to the tenant reporting currency at the current FX rate.
Excludes unconverted leads, won, lost and soft-deleted deals.

**Won revenue** (D-15, added for Account 360, M5.8). Sum, per won deal, of
`coalesce(deal_outcomes.final_value_minor, deals.negotiated_value_minor, deals.proposal_value_minor)`
for deals with `status = 'won'`, converted to the tenant reporting currency at the current FX rate.
Prefers the value actually recorded at close (`closeDeal`, M5.2) over the deal's own last value,
since a negotiated value can still move after that value was locked in at close; falls back to the
deal's value when `final_value_minor` was left blank (it is optional, M5.3). Excludes soft-deleted
deals.

**Weighted forecast.** Sum of deal value multiplied by probability, where probability is
`coalesce(probability_override, stage.probability_threshold) / 100`. Computed at query time and
never stored.

**Category forecast.** Sum of deal value grouped by `forecast_category`. Reported alongside the
weighted figure, not instead of it, because the two answer different questions: weighted is
statistical, commit is a human promise.

## Conversion and velocity — derived from stage_events only

**Stage-to-stage conversion rate.** For a period and a stage pair, the denominator is the count of
distinct deals whose earliest `stage_events` row entering stage N falls inside the period. The
numerator is how many of those same deals subsequently recorded an event entering stage N+1 or
beyond, at any later date including after the period ends. Cohort-based, never a snapshot ratio of
current-stage counts. Minimum sample: 20 deals in the denominator.

**Overall win rate.** Deals reaching a `won` stage divided by deals reaching a terminal stage
(`won` or `lost`) in the period, by close date. Deals still open are excluded from both sides —
they are not losses.

**Time in stage.** For each `stage_events` row, `duration_in_previous_seconds`. Report **median**
as the headline and mean as secondary, because consulting cycle times are right-skewed and the mean
flatters. Excludes reconstructed events. Minimum sample: 10 completed stage transits.

**Sales cycle length.** Days from the first `stage_events` row for a deal to its terminal event.
Median, computed only over closed deals. Open deals are excluded, since including them
systematically understates cycle length.

**Sales velocity.** `(qualified_opportunities × average_deal_value × win_rate) ÷ average_cycle_length_days`,
expressed as value per day. Per decision **D-05**, a qualified opportunity is one whose
qualification completeness score is at or above the tenant-configured threshold. Display the
formula and the inputs in a tooltip, so the number is auditable.

**Stage regression rate.** Deals with at least one `is_regression = true` event in the period,
over active deals. A leading loss indicator that most tools never surface.

## Loss analysis (Milestone 5)

**Value bands** — ⚠ **UNCONFIRMED DEFAULT, not a product-owner decision.** No band boundaries
existed anywhere in this repository before M5.4 needed one for its loss-reason report; the reference
benchmark PRD (`docs/reference/pipeline-intelligence-benchmark-and-prd-v1.html`, not an authoritative
spec doc per this file's own opening rule) names "value band" as a dimension but gives no boundary
values. The user was asked directly (four bands vs. three vs. custom) and did not answer before work
continued; per this session's own precedent for an unanswered business-rule question, the following
was adopted as the flagged, reversible default rather than silently invented:

- **Under ₦5,000,000**
- **₦5,000,000 – ₦24,999,999**
- **₦25,000,000 – ₦99,999,999**
- **₦100,000,000 and above**
- **Value not recorded** — a deal with neither `negotiated_value_minor` nor `proposal_value_minor`
  set. Kept as its own distinct band rather than folded into "Under ₦5,000,000", the same "null is
  not zero" reasoning this file's own "Open pipeline value" and "Days since last engagement"
  definitions already establish - collapsing an unknown value into the smallest band would silently
  misrepresent "never valued" as "valued and small."

Defined in NGN only, matching every other money example in this codebase (no currency picker exists
anywhere yet, decision **D-08b** on multi-currency/reporting-currency handling remains open) - a
deal recorded in a different currency would need real FX handling before these boundaries mean
anything for it, which is out of scope here. **Revisit this definition with the product owner before
relying on it for anything beyond the M5.4 report it was built for** - update this entry in place if
the boundaries change, rather than letting the report's own code silently drift from this doc.

**Loss-reason report.** For `deal_outcomes` rows with `result = 'loss'`, scoped to the viewer's role
(own practice for Team Lead/Director, tenant-wide for Executive/Tenant Admin, per
`analytics.view_practice` in `docs/02-permission-matrix.md`; a BDE cannot reach this report at all -
`analytics.view_practice` is denied for that role). Value is the deal's own
`coalesce(negotiated_value_minor, proposal_value_minor)` at read time (this file's own "Open pipeline
value" formula) - never `deal_outcomes.final_value_minor`, which this product only ever records for a
*won* deal (`src/services/deals.ts` `closeDeal`'s own loss path always sends it `null`; there is
nothing to band for a loss otherwise). Broken down three ways, each a simple count grouped by one
dimension against the same filtered set - by `outcome_reasons.label`, by `deals.practice_line_id`,
by the value band above, and by `deal_outcomes.competitor_name` (grouping every `null` together as
"Not specified", never silently dropped). Excludes soft-deleted deals and every `is_demo = true` row
(this file's own opening rule). No minimum-sample suppression - unlike a percentage, a raw count of
zero is itself the honest, correctly-displayed answer ("no losses recorded"), not a misleading one.

## Engagement metrics — the reason the event layer exists

**Days since last engagement.** `current_date − deals.last_engaged_at`. Null last-engaged means
never engaged, which is displayed explicitly as "never" and is not treated as zero.

**Engagement coverage.** Active deals with at least one client-facing activity in the trailing
14 days, divided by all active deals. Scoped by role: own deals for a BDE, team for a Team Lead,
practice for a Director, tenant for Executive and Tenant Admin.

**Staleness bands.** 0–7 days green, 8–21 blue, 22–45 amber, 46 or more red. Thresholds are
tenant-configurable; these are the defaults and align with the predecessor product's legend so users
are not retrained.

**Activity volume by type.** Count of non-retracted activities grouped by type and author for a
period. **Never present this as a performance ranking without a paired outcome metric** — volume
without conversion incentivises noise.

**Logging latency.** Median of `created_at::date − activity_date` across activities in the period.
A rising figure means the discipline is decaying even while volume holds.

**Time to first engagement.** Days from deal creation to the earliest client-facing activity.
Measures responsiveness on new opportunities.

## Task metrics

**On-time completion rate.** Tasks where `completed_at::date <= due_date`, over tasks completed in
the period. **Excludes cancelled tasks** — otherwise cancelling becomes a way to inflate the figure.

**Overdue count.** Tasks with `status in ('open','in_progress','blocked')` and `due_date < current_date`.

**Next-action coverage.** Active deals with `next_action_task_id is not null`, over all active deals.
The single most important adoption metric in the product.

**Delegation load.** Open tasks grouped by assignee, for spotting overload before it becomes a miss.

## Forecast accuracy

**Commit accuracy.** For a closed fiscal period: actual closed-won value divided by the commit
forecast snapshotted at period start, from `forecast_snapshots`. Reported as a percentage variance
with direction. Requires at least one full period of snapshots to exist; suppress before then.

**Slippage.** Deals whose `expected_close_date` moved out of the period, counted and valued.
Computed from the audit trail of close-date changes, not from current state.

## Attainment

**Attainment.** Closed-won value in the fiscal period divided by the applicable `quotas.target_minor`.
Rolls up user to team to practice to tenant by summing targets, never by averaging percentages.

**Pace.** Attainment divided by the fraction of the period elapsed. Above 1.0 is ahead of pace.
Uses working days, not calendar days, and respects the tenant fiscal calendar (decision **D-04**).

## Mix and source

**New versus existing client revenue.** Split on `deals.client_type` by close date.

**Source and campaign performance.** Lead volume, conversion to deal, conversion to won, and
closed-won value, grouped by `lead_source_id` and campaign. Requires the lead object (Milestone 7).

## Risk score (Milestone 9)

Weighted, **always explainable** — the interface must show the contributing factors, never a bare
number. Inputs: days since last engagement, days in current stage versus the practice median,
stakeholder count below two, any stage regression, overdue task count, and close-date slippage
count. Calibrate weights against historical won and lost outcomes before display; ship the factor
breakdown before shipping the score.

## Presentation rules that apply to every metric

State the period and the comparison basis on every panel. Show the sample size wherever a percentage
appears. Display "insufficient data" rather than a spurious figure. Disclose exclusions in a footnote,
particularly reconstructed events. Never show a percentage change against a zero baseline as a
percentage — say "no prior activity" instead.
