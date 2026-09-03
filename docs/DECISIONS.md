# DECISIONS — Open Questions and Decision Log

## How this file works

**Claude Code: if a task you are asked to perform depends on a question in Part A that is still
unanswered, stop and ask. Do not choose a plausible default and continue.** Silent defaults on
these questions produce software that is subtly wrong in ways that only surface in a leadership
review months later.

When a question is answered, move it to Part B with the date and the person who decided.

---

## Part A — Open questions blocking implementation

### D-08b — Which currencies are enabled per tenant, and what is each tenant's default reporting currency?
**Blocks:** seeding `currencies` per tenant, the reporting-currency default on `tenants.reporting_currency`.
**Status:** the FX **rate source** is decided (D-08, Part B) — this remaining half is just the enabled
currency list and the default. The predecessor product supported NGN, USD and GBP
(`docs/reference/pipeline-intelligence-benchmark-and-prd-v1.html`, capability C21); that is a
reasonable starting list if no different set is wanted, but it has not been explicitly confirmed for
this build. `tenants.reporting_currency` in `db/schema.sql` currently defaults to `'NGN'`.

### D-09b — Which specific finance/ERP system, and on what contract?
**Blocks:** the concrete FR-12.3 connector (M9.7) — not the API itself.
**Status:** the *mechanism* is decided (D-09, Part B): hand-off happens through the public API
(FR-12.1/M9.6), not a bespoke point-to-point integration. This remaining question is only which
system a real connector should target and its payload contract, needed when M9.7 is actually built.
No immediate blocker.

### D-12 — What are the loss-reason report's "value band" boundaries?
**Blocks:** `docs/04-metric-definitions.md`'s "Value bands" definition and M5.4's loss-reason report,
which both currently ship against a flagged, unconfirmed default rather than this question being
resolved first.
**Status:** asked directly (four bands under ₦5M/₦5–25M/₦25–100M/₦100M+, three coarser bands, or
custom boundaries) and not yet answered. Per this file's own header rule this should have blocked
work; it did not, because the session's standing instruction was to continue past an unanswered
question with the most-recommended option flagged rather than stall - the same precedent M5.2's
atomicity question set. **The four-band default above is live in the report today. Confirm or
replace it with the product owner before this report is relied on for any real decision**, and
update `docs/04-metric-definitions.md`'s own entry to match whatever is decided, the same way
`tenants.reporting_currency`'s D-08b note tracks its own still-open half.

### D-13 — What does "past Discovery" mean for the single-threading warning, for a tenant whose own stage list has no stage literally named "Discovery"?
**Blocks:** `docs/06-ui-spec.md`'s Stakeholders section and M5.6's single-threading warning, which
ships against a flagged, unconfirmed default rather than this question being resolved first.
**Status:** "Discovery" names no reserved stage code or structural concept anywhere in
`docs/01-domain-model.md` - `pipeline_stages` are fully tenant-configurable (migration 0005), and
the name traces back to the external benchmark PRD's own illustrative "Discovery Call" example
stage, not a rule this codebase's own docs otherwise define. Asked directly (past the first open
stage, a literal name/code match, or a custom rule) and not yet answered; per this file's own header
rule this should have blocked work, and did not, for the same reason D-12 didn't. **"Past the first
open stage" (the deal's current `sort_order` strictly greater than the tenant's own earliest
open-type stage) is live today** - `src/domain/deal.ts`'s `isPastFirstOpenStage`/
`showsSingleThreadingWarning`. Confirm or replace with the product owner before this warning is
relied on for anything, and update that function's own comment and this entry together if it
changes.

### D-14 — Should a linked contact's decision role or primary status be editable after M5.6 links it?
**Blocks:** nothing yet blocked outright - M5.6 shipped add-only (matching migration 0018's own
insert-only `deal_contacts` schema and RLS), so this is a scope question for a future milestone, not
a defect in M5.6 itself.
**Status:** migration 0018's own header comment explicitly named M5.6 "the obvious candidate" to add
an update/reassign action if one turns out to be needed, without asserting it must be. Asked
directly (ship add-only vs. build editing now, with a new permission action and an RLS migration)
and not yet answered. Per this session's standing precedent, add-only was adopted as the default,
since it is also what `docs/06-ui-spec.md`'s own Stakeholders text most directly supports (decision-
role badges and the primary flag are described with display nouns, no verb implying editability).
**If a future milestone needs to let a user change a decision role or reassign primary, it will need
a new permission action (e.g. `contact.update_deal_role`/`deal.reassign_primary_contact`), a
docs/02-permission-matrix.md update, and a migration adding UPDATE policies to `deal_contacts`** -
none of that exists today.

---

## Part B — Decisions made

| # | Decision | Rationale | Decided by | Date |
|---|---|---|---|---|
| D-01 | (a) Advisory only — activity logging is not mandatory before stage advancement. Visibility and staleness flags do the work instead. | Product owner's call. No enforcement code exists yet (stage-gate rules are M6/M7); when `FR-8.3`/M7.8 stage-gate validation is built, it must **not** include an engagement-logged condition unless this decision is revisited. | Product owner (foluso.aribisala@workforcegroup.com) | 2026-07-27 |
| D-02 | (b) Practice-wide read, own write — a BDE may read every deal in their practice line but write only own/co-owned/authored deals | Confirmed by the product owner ("they can see but can't make changes"). Matches what `db/schema.sql` already implements (`deals_select` grants read via `entitled_practices()` regardless of role; `deals_update` restricts BDE writes to own/co-owned/authored) — no schema change was needed. Supersedes the earlier provisional entry. | Product owner (foluso.aribisala@workforcegroup.com) | 2026-07-27 |
| D-06 | Yes — the Executive role may read full engagement narratives, not just aggregates | Confirmed by the product owner. Matches `db/schema.sql`'s `activities_select` policy, which already grants `has_role('executive')` unrestricted read; the "pending decision D-06" comment there has been removed now that it's resolved. `docs/02-permission-matrix.md`'s footnote is updated to match. | Product owner (foluso.aribisala@workforcegroup.com) | 2026-07-27 |
| D-12 | Stages are a tenant-scoped table with stable, immutable `code` identifiers, configurable per tenant | Confirmed by the product owner. Matches architectural decision A-01 and the `pipeline_stages` table already in `db/schema.sql` — no schema change was needed. | Product owner (foluso.aribisala@workforcegroup.com) | 2026-07-27 |
| D-03 | (b) One account, with a per-practice-line relationship owner | Confirmed by the product owner. This changes the data model: a single `accounts.owner_id` cannot express "one owner per practice line," so `db/schema.sql` and `docs/01-domain-model.md` were updated — `accounts.owner_id` removed, replaced with an `account_practice_owners (account_id, practice_line_id, owner_id)` table, one row per practice line relationship. Unblocks M5.8 (Account 360). | Product owner (foluso.aribisala@workforcegroup.com) | 2026-07-27 |
| D-04 | Fiscal calendar is uniform across all practice lines within a tenant, but may vary by tenant. Fiscal year starts January, period granularity is monthly. | Confirmed by the product owner. Matches `tenants.fiscal_year_start_month` (already defaults to `1`, already per-tenant — no schema change needed). `docs/01-domain-model.md`'s `quotas.fiscal_period` example was corrected from a quarterly example (`2026-Q3`) to a monthly one (`2026-01`) to stop contradicting this decision. | Product owner (foluso.aribisala@workforcegroup.com) | 2026-07-27 |
| D-05 | (b) Qualification completeness at or above a threshold defines a qualified opportunity, and the threshold is tenant-configurable | Confirmed by the product owner. Matches FR-7.2's existing intent ("a tenant may require a minimum completeness threshold") — no schema change needed; the actual default threshold value is set per tenant at implementation time (M9.2), not fixed here. | Product owner (foluso.aribisala@workforcegroup.com) | 2026-07-27 |
| D-07 | Email body storage off by default; metadata plus an optional excerpt only; per-thread exclusion available to the user; tenant-level override. | Product owner confirmed the kit's recommendation as-is. | Product owner (foluso.aribisala@workforcegroup.com) | 2026-07-27 |
| D-08 | FX rate source is an external, live, web-based provider — not manually entered rates. | Product owner's intent, citing xe.com as the kind of source meant. **Flag:** xe.com the marketing website is not itself an API; the real product in that family is the XE Currency Data API (`xecdapi.xe.com`), a separate paid/keyed service — and there are comparable alternatives (Open Exchange Rates, exchangerate.host, currencylayer). The specific vendor and API key are an implementation choice for M8.8, not a business decision, so it's left open at that level; `fx_rates.source` in `docs/01-domain-model.md` already has a free-text field for whichever is chosen. See D-08b for the still-open currency list. | Product owner (foluso.aribisala@workforcegroup.com) | 2026-07-27 |
| D-09 | Yes, a finance/ERP hand-off for closed-won deals is needed, delivered through a public API endpoint rather than a bespoke integration. | Product owner confirmed the hand-off and specified the mechanism (API). Matches FR-12.1 (M9.6) already being planned as a public API; M9.7's ERP connector will consume it. See D-09b for the still-open question of which specific system. | Product owner (foluso.aribisala@workforcegroup.com) | 2026-07-27 |
| D-10 | No fixed seat limits or plan tiers yet — keep both flexible/configurable per tenant. | Product owner: "still to be defined hence flexible for now." Already matches the schema as built: `tenants.seat_limit` is a per-tenant integer (default 25, not a fixed global constant) and `tenants.plan_tier` is free text (not a fixed enum) — no change needed. Revisit with real values once commercial plan tiers are defined. | Product owner (foluso.aribisala@workforcegroup.com) | 2026-07-27 |
| D-11 | Recycle bin 30 days; audit log retention 7 years; backup retention 30 days. | Product owner confirmed all three kit recommendations after the implications of each were explained. | Product owner (foluso.aribisala@workforcegroup.com) | 2026-07-27 |
| D-15 | "Won revenue" (Account 360, M5.8) = `coalesce(deal_outcomes.final_value_minor, deals.negotiated_value_minor, deals.proposal_value_minor)`, summed per won deal. | `docs/04-metric-definitions.md` defines "Open pipeline value" precisely but had no formula for "won revenue" at all, which `docs/06-ui-spec.md`'s Account 360 tile names — asked per that file's own "never invent a metric formula" rule rather than guessed. Prefers the actual value recorded at close (M5.2's `closeDeal`) but falls back to the deal's own last value when `final_value_minor` was left blank (it's optional, M5.3). `docs/04-metric-definitions.md` gained its own "Won revenue" entry to match. | Product owner (foluso.aribisala@workforcegroup.com) | 2026-08-22 |
| D-16 | "Stage-to-stage conversion rate" (M6.2) excludes reconstructed `stage_events` rows (`is_reconstructed = true`) from both the cohort and advancement counts, even though the metric is count/cohort-based, not duration-based. | `docs/04-metric-definitions.md`'s general reconstructed-event exclusion rule is textually scoped to "every duration-based metric," and this metric's own definition was silent on the question — a genuine formula ambiguity per that file's own "never invent a metric formula" rule, not a default. The product owner confirmed reconstructed rows should be excluded here too, matching the doc's general framing of them as migration artefacts rather than real activity. Currently inert either way — no code path in this codebase has ever set `is_reconstructed = true` (no backfill tool exists) — but the formula is now unambiguous for whenever one does. | Product owner (foluso.aribisala@workforcegroup.com) | 2026-09-01 |
| D-17 | "Bottleneck highlighting" (Time in stage, M6.3) = a stage's own median time-in-stage exceeds that SAME stage's own `bottleneck_threshold_days`, a new per-stage, tenant_admin-editable column (`pipeline_stages.bottleneck_threshold_days`, nullable, no cross-tenant default) with a real settings screen (`/admin/pipeline-stages`) built now rather than deferred. | The word "bottleneck" appears exactly once in the entire docs set (the M6.3 backlog line itself) with zero elaboration — a genuine formula gap, not a stylistic one. Asked directly: relative ("highest median among sufficient-sample stages") vs. an absolute threshold vs. no highlighting yet. The product owner chose an absolute threshold, then per-stage rather than one tenant-wide number (Discovery and Negotiation don't take the same amount of time by nature), then a real settings screen now rather than a hardcoded default the way the loss-reason value bands (D-12) shipped. Never flagged while a stage has no threshold set, and never flagged while `insufficient_data` (fewer than 10 completed transits). | Product owner (foluso.aribisala@workforcegroup.com) | 2026-09-02 |
| D-18 | Two related M6.5 decisions. (a) "Team" (Engagement analytics) = a Team Lead's direct reports plus themselves, via a new `user_roles.manager_id` column (migration 0021, nullable, validated by trigger against an active `team_lead` in the same tenant/practice line) set through a new `/admin/team-assignments` screen — not the whole practice (that stays "team" for `getTeamOverview`'s pre-M6.5 behaviour, now corrected to match). A Team Lead with nobody assigned reads as a team of just themselves, never an empty result or a practice-wide fallback. (b) "Activity volume by type, paired with conversion" = a per-type breakdown by `outcome_disposition` (positive/neutral/negative/no_response, plus a `noDispositionCount` for activities with none recorded) — not a stage-advancement/win-rate definition of "conversion." | (a) `docs/04-metric-definitions.md`'s own "Engagement coverage" text ("own deals for a BDE, **team** for a Team Lead, practice for a Director") is the first metric requiring a "team" narrower than "practice" — nothing in the schema distinguished them before now, and `getTeamOverview` (M4.6) had documented this exact gap ("team_lead's team and director's practice were the identical set"). Asked directly rather than defaulted: the product owner chose to build a real team concept now, with a real admin screen, rather than a column-only placeholder — then confirmed the fallback for an unassigned Team Lead is themselves alone, never a misleadingly-inflated practice-wide number. (b) The word "conversion" in this milestone's own backlog line is not defined anywhere in `docs/04-metric-definitions.md`; asked directly, the product owner chose disposition-pairing over a stage-advancement definition, since `activities.outcome_disposition` already exists and is populated with no new mechanism needed. | Product owner (foluso.aribisala@workforcegroup.com) | 2026-09-02 |
| D-19 | Two related M6.6 decisions. (a) Task analytics (on-time completion rate, overdue count, delegation load) uses the same own/team/practice/tenant scope Pipeline metrics (M6.1) and Engagement analytics (M6.5) use, gated on `analytics.view_own` — a bde is never denied, only narrowed to their own tasks. (b) Delegation load is a new, separately-scoped function (`getTaskAnalytics`), not a reuse or extension of `getTeamOverview` (M4.6/M6.5) — it lists only assignees who currently hold at least one open task, with no completed/overdue breakdown and no leader-only gate, a literal reading of "open tasks grouped by assignee" rather than `getTeamOverview`'s richer, leader-only, every-member-including-zero view. | Neither `docs/04-metric-definitions.md`'s Task metrics section nor `docs/02-permission-matrix.md`'s footnotes state a scope for any of the three metrics — a genuine gap, not a stylistic omission, per this file's own "never invent a metric formula" rule extended to scope the same way M6.5's own team-scope question was. (a) Asked directly: the product owner chose the inclusive four-way model over the practice/tenant-only model M6.2-M6.4/M5.4 use (which denies a bde outright) — on-time rate and overdue count read as personal accountability metrics for the person doing the work, the same way Engagement coverage does for a bde's own deals. (b) `getTeamOverview` already computes near-identical per-assignee data but is scoped to a different audience (My Work's Team tab, team_lead/director only, denying bde and executive) for a different purpose (team management, not tenant-wide analytics) — asked directly rather than silently reused or silently duplicated, and the product owner confirmed a new, narrower function over widening `getTeamOverview`'s own already-shipped scope. | Product owner (foluso.aribisala@workforcegroup.com) | 2026-09-03 |

---

## Part C — Architectural decisions pre-made in this kit

These are already settled and are recorded so nobody relitigates them mid-build.

| # | Decision | Rationale |
|---|---|---|
| A-01 | Stages are a table with stable UUIDs, not an enum | Renaming a stage must never orphan historical events |
| A-02 | Activities are append-only with a revisions table | Engagement history is evidence and must be tamper-evident |
| A-03 | Stage movement is an event log, not date columns on the deal | Date columns cannot express regression, duration or actor, and cannot support a funnel |
| A-04 | Money stored as bigint minor units plus currency code | Floats produce reconciliation errors |
| A-05 | Soft delete everywhere, no user-facing hard delete | Accidental loss is unrecoverable and destroys trust |
| A-06 | Permission matrix is data, not scattered conditionals | The predecessor product's worst defect was a permission gap that no test could catch |
| A-07 | Derived fields written transactionally, not batched | A stale staleness indicator is worse than none |
| A-08 | Tasks are a first-class entity, never a text field on a deal | Delegation and overdue tracking are impossible otherwise |
| A-09 | Demo and seed rows carry `is_demo` and are excluded from metrics | Demo data must never inflate a real forecast |
| A-10 | Custom fields are typed definitions with a values table, not JSON blobs | Reporting on JSON is unmaintainable |
