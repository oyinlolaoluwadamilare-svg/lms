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
