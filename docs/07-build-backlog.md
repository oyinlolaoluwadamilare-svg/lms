# 07 — Build Backlog

Dependency-ordered. **Do not start a milestone whose predecessor is incomplete.** Each task is scoped
to one working session and ends in a reviewable, shippable slice. Where a task depends on an open
decision, the decision id is named and the task is **blocked** until answered.

Legend: 🔒 blocked by a decision · ⚑ human review gate mandatory before merge

---

## M0 — Foundation (before any feature)

**M0.1** Repository scaffold: Next.js, TypeScript strict, Tailwind, Vitest, Playwright, lint rules
enforcing the layering in `03-architecture.md`. CI running typecheck, lint, unit, integration, RLS
and permission suites.
**M0.2** Supabase project, migration tooling, and the `tenants`, `practice_lines`, `users`,
`user_roles` tables from `db/schema.sql` with RLS and helper functions. ⚑
**M0.3** Auth: sign-in, password reset, session handling, suspended-user denial. **No self-service
account creation** — users exist only by invitation.
**M0.4** The permission matrix as typed data in `src/auth/permissions.ts`, the `can()` guard, and the
completeness test that fails on any untested role-action pair. ⚑ **This ships before any feature.**
**M0.5** RLS test harness connecting as each role identity; cross-tenant isolation proven on every
existing table. ⚑
**M0.6** Audit service: `writeAudit()` inside the caller's transaction, append-only enforcement
triggers, and a test proving update and delete raise.
**M0.7** Design tokens, layout shell, role-aware navigation, and the standard loading, empty, error
and denied states.
**M0.8** Deterministic seed script with `is_demo` on every row, plus the CI assertion that demo rows
never appear in a metric query.

**Exit:** an authenticated user of each role sees a correct, empty shell; every permission pair is
tested; cross-tenant isolation is proven.

---

## M1 — Deals and pipeline 🔒 D-02, D-12

**M1.1** `pipeline_stages`, `accounts`, `deals`, `deal_co_owners` migrations with all constraints,
including the active-deal-requires-owner-and-close-date check.
**M1.2** Deal repository and domain logic: probability resolution, weighted value, reference generation.
**M1.3** Create-deal flow with Zod validation, requiring owner and expected close date. Author is
always the creating user — the "Unknown Author" state must be unrepresentable.
**M1.4** Pipeline table view with the advanced filter set.
**M1.5** Pipeline board view with drag, routed through the single `changeStage` service path.
**M1.6** Deal detail read-only skeleton: header, financial summary, details, account.
**M1.7** Edit deal, with audit entries on every field change.
**M1.8** ⚑ Permission and RLS tests for every deal action, allow and deny, per role.

**Exit:** deals can be created, listed, filtered, moved and edited by entitled roles only; no deal can
exist active without an owner and a close date.

---

## M2 — Stage event history (before any analytics)

**M2.1** `stage_events` table, immutability triggers, and the regression-derived column.
**M2.2** Refactor so **every** stage transition path calls `changeStage`, writing exactly one event.
Test each path: form, board, API, bulk, mark-won, mark-lost.
**M2.3** Days-in-current-stage derived from the latest event; staleness colour on board and table.
**M2.4** Stage-history panel on the deal, showing transitions with actor, date and duration.

**Exit:** no stage change is possible without an event; duration and regression are queryable.

---

## M3 — Engagement timeline ⚑ (the reason the product exists)

**M3.1** `activities`, `activity_revisions`, `activity_contacts` migrations, with the future-date
constraint, the generated `is_client_facing` column, and `stage_id_at_time` capture.
**M3.2** `logActivity` service: the single creation path, deriving `last_engaged_at`,
`engagement_count` and the audit row in one transaction.
**M3.3** ⚑ RLS policy for activity insert, **with the named test "a user holding only the bdm role can
create an activity on a deal they own"**. This is the predecessor's exact defect; it must be
impossible to regress.
**M3.4** Log Activity modal meeting the three-interaction constraint, with keyboard shortcut and
Ctrl+Enter save.
**M3.5** Engagement timeline component merging activities and stage events, newest first, with type and
author filters and a designed empty state.
**M3.6** Edit within the 24-hour window with revision history and an "edited" marker; retraction by
Director or Admin with a mandatory reason, rendered struck through.
**M3.7** Last-engaged chip on the deal header; last-engaged column, sort and "days since last
engagement" filter on the pipeline views; staleness bands wired to the at-risk tile.
**M3.8** Attachments on activities, inheriting deal visibility.
**M3.9** ⚑ Timezone test suite: an activity logged at 23:30 WAT renders the correct local date, and
`activity_date` is never conflated with `created_at` in any response.

**Exit:** every writing role can log an engagement in three interactions; the timeline is complete,
append-only and tamper-evident; staleness is visible everywhere.

---

## M4 — Tasks and delegation ⚑

**M4.1** `tasks`, `task_assignments`, `task_comments`, `task_watchers` migrations with the blocked
and done constraints.
**M4.2** `assignTask` as the single assignment path, writing the ledger entry and notification.
**M4.3** Add Task modal with the scope-filtered assignee picker; "Save and add task" continuation from
the activity modal.
**M4.4** `next_action_task_id` derivation trigger; the next-action strip and the "No next step" state
on the deal header.
**M4.5** My Work screen: grouped queue, inline complete, snooze with reason after two snoozes,
reassign, plus the "Assigned by me" tab.
**M4.6** Team view for Team Lead and Director with per-person open, overdue and completed counts.
**M4.7** "No next step" filter and dashboard tile listing active deals lacking an open task.
**M4.8** Notification events for assigned, reassigned, overdue and mentioned, with per-type user
preferences replacing coarse toggles.
**M4.9** Comments, watchers and @mention with an in-scope user picker.
**M4.10** ⚑ Permission tests: a BDM can assign to a practice peer; an Executive cannot assign at all;
reassignment history is never overwritten.

**Exit:** work is delegable and chaseable; every open deal shows its next action or is flagged.

---

## M5 — Win/loss discipline and contacts 🔒 D-03

**M5.1** `outcome_reasons` admin configuration; `deal_outcomes` migration.
**M5.2** `closeDeal` service: atomic outcome, stage event, status, open-task cancellation, audit.
Closing is impossible without a reason; loss requires detail; lost-to-competitor requires a name.
**M5.3** Mark Won and Mark Lost dialogs enforcing the above.
**M5.4** Loss-reason report by practice, value band and competitor.
**M5.5** `contacts`, `deal_contacts` migrations; primary-contact invariant.
**M5.6** Contact management on the deal with decision-role badges; single-threading warning past
Discovery.
**M5.7** Activity attribution to contacts; contact-level last-engaged.
**M5.8** Account 360 screen. 🔒 blocked by D-03 on ownership model.
**M5.9** Handover panel: last ten engagements, open tasks and contacts, shown on owner change.

**Exit:** nothing closes without a reason; deals carry stakeholder maps; relationships survive turnover.

---

## M6 — Analytics rebuilt on events 🔒 D-04, D-05

**M6.1** Metric layer implementing `04-metric-definitions.md` exactly, with sample-size suppression
and reconstructed-event exclusion.
**M6.2** Cohort conversion funnel; remove any current-state approximation.
**M6.3** Time in stage with median headline; bottleneck highlighting.
**M6.4** Sales velocity. 🔒 blocked by D-05.
**M6.5** Engagement analytics: coverage, volume by type paired with conversion, logging latency, time
to first engagement, next-action coverage — all role-scoped.
**M6.6** Task analytics: on-time rate excluding cancellations, overdue counts, delegation load.
**M6.7** Stage regression report.
**M6.8** Role-scoped dashboards for BDM, Team Lead, Director and Executive.
**M6.9** Saved views and CSV/PDF export.

**Exit:** every metric traces to an event; no panel displays a figure below its minimum sample.

---

## M7 — Email, calendar and automation 🔒 D-07

**M7.1** `email_connections` with encrypted server-side tokens; user-initiated OAuth for Zoho,
Google and Outlook. ⚑ **No path permits connecting another user's mailbox.**
**M7.2** Inbound and outbound mail matching to contacts, generating activities via `logActivity`.
🔒 blocked by D-07 on body storage.
**M7.3** Per-thread privacy exclusion.
**M7.4** Calendar sync creating meeting activities; internal-only meetings excluded.
**M7.5** Send-from-deal with logging.
**M7.6** Automation rules engine with dry-run preview, versioning and a traceable run log. ⚑
**M7.7** Default staleness rules: follow-up task at 14 days, escalate to Team Lead at 30, Director at
45; overdue-task escalation at 72 hours.
**M7.8** Stage-gate validation with Director override requiring a reason. 🔒 D-01.
**M7.9** Task templates per stage per practice.

**Exit:** most engagement is captured without typing; the system chases without human vigilance.

---

## M8 — Forecasting, quotas and governance 🔒 D-04, D-08, D-11

**M8.1** Forecast categories with override and reason; category totals alongside weighted.
**M8.2** `quotas` for user, team, practice and tenant per period; attainment and pace. 🔒 D-04.
**M8.3** Weekly `forecast_snapshots` job; commit accuracy reporting.
**M8.4** Slippage report derived from close-date audit history.
**M8.5** In-app audit log viewer with filters and export. ⚑
**M8.6** Duplicate detection with review queue; admin merge preserving all children, reversible 30
days. ⚑
**M8.7** Soft delete and recycle bin with restore. 🔒 D-11.
**M8.8** Multi-currency with FX rates and reporting currency. 🔒 D-08.
**M8.9** Custom fields builder with typed values and required-at-stage rules.

**Exit:** the forecast is defensible; data quality is enforced; every change is inspectable in-app.

---

## M9 — Leads, content, platform, then intelligence

**M9.1** `leads` with capture, qualification, scoring and convert-to-deal preserving history.
Unconverted leads excluded from pipeline value.
**M9.2** Qualification framework with completeness gating. 🔒 D-01, D-05.
**M9.3** Routing rules and response-time SLA.
**M9.4** Source and campaign attribution through to revenue.
**M9.5** Documents with versioning and deal linkage; templates; sequences with reply detection;
proposal generation and e-signature integration.
**M9.6** Public API and webhooks, honouring the same permission matrix. ⚑
**M9.7** Slack or Teams notifications; ERP hand-off for closed-won. 🔒 D-09.
**M9.8** Responsive PWA with offline read and a queued write path for activities and tasks.
**M9.9** Risk score — **ship the explainable factor breakdown before the number**; calibrate against
historical outcomes.
**M9.10** Next-best-action, engagement summarisation and natural-language reporting, all role-scoped.

**Exit:** the pipeline is fed, the platform is extensible, and intelligence rests on real history.

---

## Sequencing notes

M2 must precede M6 by at least one full sales cycle of real usage, or the analytics will be
technically correct and practically meaningless. M4 depends on M3, because a task without engagement
context is an orphan. M7 mail sync depends on M5 contacts, because matching requires contact records.
M9.9 and M9.10 depend on twelve or more months of accumulated activity and outcome data; attempting
them earlier trains on emptiness. Resist reordering to reach the visually impressive work sooner —
the value of this product is in M3 and M4, which look modest and are not.
