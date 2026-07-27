# DECISIONS — Open Questions and Decision Log

## How this file works

**Claude Code: if a task you are asked to perform depends on a question in Part A that is still
unanswered, stop and ask. Do not choose a plausible default and continue.** Silent defaults on
these questions produce software that is subtly wrong in ways that only surface in a leadership
review months later.

When a question is answered, move it to Part B with the date and the person who decided.

---

## Part A — Open questions blocking implementation

### D-03 — Who owns an account when several practice lines sell into the same client?
**Blocks:** account model, account 360 visibility, cross-sell reporting.
**Options:** (a) single global account owner; (b) one account with per-practice relationship owners;
(c) account per practice line, linked by a parent group record.
**Consideration:** (b) reflects reality in multi-practice firms but is more complex. (c) fragments
the client view, which is one of the things the product is meant to fix.

### D-04 — What is the fiscal calendar, and is it uniform across all practice lines?
**Blocks:** quotas, forecast snapshots, attainment pace, every period comparison.
**Needed:** fiscal year start month, period granularity (monthly or quarterly), and whether any
practice runs a different calendar.

### D-05 — What is the definition of a qualified opportunity for sales-velocity purposes?
**Blocks:** the velocity metric and the qualification gate.
**Options:** (a) entry into Discovery Call; (b) qualification completeness at or above a threshold;
(c) explicit manual qualification flag.

### D-07 — Is email body content stored, or only metadata?
**Blocks:** mail synchronisation design, data protection posture, storage sizing.
**Recommendation to confirm:** metadata plus optional excerpt, body storage off by default,
per-thread exclusion available to the user, tenant-level override.

### D-08 — Which currencies, and what is the reporting currency per tenant?
**Blocks:** money model, FX table, every financial roll-up.
**Needed:** the enabled currency list, the reporting currency, the FX rate source, and whether open
pipeline converts at current rate while closed deals lock the rate at close.

### D-09 — Does a finance or ERP system need closed-won hand-off, and on what contract?
**Blocks:** integration design in M8.

### D-10 — What are the tenant seat limits and the commercial plan tiers?
**Blocks:** seat enforcement on invitation, plan gating.

### D-11 — Retention periods: recycle bin, audit log, backups.
**Blocks:** governance implementation and any regulatory commitment.
**Recommendation to confirm:** 30-day recycle bin, 7-year audit retention, 30-day backup retention.

---

## Part B — Decisions made

| # | Decision | Rationale | Decided by | Date |
|---|---|---|---|---|
| D-01 | (a) Advisory only — activity logging is not mandatory before stage advancement. Visibility and staleness flags do the work instead. | Product owner's call. No enforcement code exists yet (stage-gate rules are M6/M7); when `FR-8.3`/M7.8 stage-gate validation is built, it must **not** include an engagement-logged condition unless this decision is revisited. | Product owner (foluso.aribisala@workforcegroup.com) | 2026-07-27 |
| D-02 | (b) Practice-wide read, own write — a BDE may read every deal in their practice line but write only own/co-owned/authored deals | Confirmed by the product owner ("they can see but can't make changes"). Matches what `db/schema.sql` already implements (`deals_select` grants read via `entitled_practices()` regardless of role; `deals_update` restricts BDE writes to own/co-owned/authored) — no schema change was needed. Supersedes the earlier provisional entry. | Product owner (foluso.aribisala@workforcegroup.com) | 2026-07-27 |
| D-06 | Yes — the Executive role may read full engagement narratives, not just aggregates | Confirmed by the product owner. Matches `db/schema.sql`'s `activities_select` policy, which already grants `has_role('executive')` unrestricted read; the "pending decision D-06" comment there has been removed now that it's resolved. `docs/02-permission-matrix.md`'s footnote is updated to match. | Product owner (foluso.aribisala@workforcegroup.com) | 2026-07-27 |
| D-12 | Stages are a tenant-scoped table with stable, immutable `code` identifiers, configurable per tenant | Confirmed by the product owner. Matches architectural decision A-01 and the `pipeline_stages` table already in `db/schema.sql` — no schema change was needed. | Product owner (foluso.aribisala@workforcegroup.com) | 2026-07-27 |

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
