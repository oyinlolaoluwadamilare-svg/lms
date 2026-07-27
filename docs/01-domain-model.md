# 01 — Domain Model

Entity reference. Field lists are authoritative for naming. Types are PostgreSQL.
Every tenant-scoped table carries `tenant_id uuid not null` and `deleted_at timestamptz`.
Every mutable table carries `created_at`, `updated_at`, `created_by`, `updated_by`.

## Aggregate map

```
Tenant
├── PracticeLine ──────────────┐
├── User ── UserRole ──────────┤ (role scoped to practice line)
├── PipelineStage (ordered, probability threshold, stable id)
├── CustomFieldDef ── CustomFieldValue
├── Account ── Contact
│     └── Deal ──┬── DealContact (decision role, is_primary)
│                ├── Activity ──┬── ActivityRevision
│                │              └── ActivityContact
│                ├── Task ──────┬── TaskAssignment (history)
│                │              ├── TaskComment
│                │              └── TaskWatcher
│                ├── StageEvent (immutable)
│                ├── DealOutcome (win/loss reason)
│                ├── ForecastSnapshot (weekly)
│                └── Document (versioned)
├── Lead ── QualificationAnswer ── (converts to Deal)
├── Quota (user | team | practice | tenant, per period)
├── AutomationRule ── AutomationRun
├── Notification
├── EmailConnection ── EmailThread / CalendarEvent
└── AuditEntry (append-only)
```

## Core entities

### tenants
`id, name, slug, plan_tier, seat_limit, reporting_currency, fiscal_year_start_month, timezone (default 'Africa/Lagos'), date_format (default 'DD/MM/YYYY'), logo_url, is_active`

### practice_lines
`id, tenant_id, name, code, region, is_active, sort_order`

### users
`id (matches auth user), tenant_id, full_name, email, department, job_title, timezone, date_format, avatar_url, status (active|pending|suspended|inactive), last_active_at`

### user_roles
`id, tenant_id, user_id, role (tenant_admin|executive|director|team_lead|bde), practice_line_id (null for tenant-wide roles), granted_by, granted_at, revoked_at`
**Invariant:** a user may hold multiple rows; effective permission is the union. `executive` and
`tenant_admin` are tenant-wide and must have `practice_line_id is null`. `bde` and `team_lead`
must have a non-null practice line.

### pipeline_stages
`id, tenant_id, name, code (stable, immutable), sort_order, probability_threshold (0-100), colour_hex, stage_type (open|won|lost), is_active`
**Invariant:** `code` is never mutated. Renaming changes `name` only. Exactly one `won` and one
`lost` stage per tenant.

### accounts
`id, tenant_id, name, normalised_name (generated, for duplicate matching), industry, region, size_band, parent_account_id, website, owner_id, is_demo`
**Invariant:** `(tenant_id, normalised_name)` unique among non-deleted rows; creation warns on fuzzy match.

### contacts
`id, tenant_id, account_id, first_name, last_name, job_title, email, phone, linkedin_url, is_active, last_engaged_at (derived), is_demo`

### deals
`id, tenant_id, reference (short human id), name, account_id, practice_line_id, stage_id, client_type (new|existing), lead_source_id, owner_id (NOT NULL when active), author_id (NOT NULL), status (active|won|lost|on_hold), proposal_value_minor, negotiated_value_minor, currency_code, probability (derived from stage, overridable), forecast_category (pipeline|best_case|commit|closed), forecast_category_override_by, forecast_category_override_reason, expected_close_date (NOT NULL when active), actual_close_date, brief, last_engaged_at (derived), last_engaged_activity_id, engagement_count (derived), next_action_task_id (derived), next_action_due_date (derived), risk_score, risk_factors jsonb, is_demo`
**Invariants:** an active deal must have `owner_id` and `expected_close_date`. `weighted_value` is
derived, never stored. Transitioning to won or lost requires a `deal_outcomes` row in the same transaction.

### deal_co_owners
`deal_id, user_id, added_by, added_at` — co-owner must belong to the deal's practice line.

### deal_contacts
`deal_id, contact_id, decision_role (champion|economic_buyer|influencer|technical_evaluator|procurement|blocker|unknown), is_primary, added_at, added_by`
**Invariant:** exactly one `is_primary = true` per deal when any contact exists.

## The execution layer

### activities  — APPEND-ONLY
`id, tenant_id, deal_id, account_id, type (note|call|email|meeting|follow_up|site_visit|proposal_walkthrough|internal_review), is_client_facing (generated from type), activity_date (date, NOT NULL), summary (NOT NULL), outcome, outcome_disposition (positive|neutral|negative|no_response|null), stage_id_at_time (captured on insert), author_id, source (manual|email_sync|calendar_sync|migration), edit_locked_at, retracted_at, retracted_by, retraction_reason, is_demo`
**Invariants:** `activity_date` may not be in the future — future intent is a Task, not an Activity.
Editable by the author only until `edit_locked_at` (creation plus 24 hours). No delete path exists.
Inserting a client-facing activity updates the parent deal's `last_engaged_at` in the same transaction.
`stage_id_at_time` is captured so a backdated entry remains attributable to the correct stage.

### activity_revisions
`id, activity_id, field_name, previous_value, new_value, changed_by, changed_at`

### activity_contacts
`activity_id, contact_id` — attribution to one or more stakeholders; updates contact `last_engaged_at`.

### tasks
`id, tenant_id, deal_id, account_id, contact_id, origin_activity_id, title (NOT NULL), description, assignee_id (NOT NULL), assigned_by (NOT NULL), due_date (NOT NULL), due_time, priority (low|normal|high|urgent), status (open|in_progress|blocked|done|cancelled), blocked_reason, snooze_count, completed_at, completed_by, template_item_id, is_demo`
**Invariants:** `assignee_id` must be within the assigner's permission scope at time of assignment.
Blocking requires `blocked_reason`. Completing sets `completed_at` and `completed_by`. Reassignment
appends to `task_assignments` and never overwrites history. Closing a deal cancels remaining open tasks.

### task_assignments / task_comments / task_watchers
As named; `task_assignments` is the immutable reassignment ledger.

### stage_events  — IMMUTABLE
`id, tenant_id, deal_id, from_stage_id, to_stage_id, actor_id, occurred_at, duration_in_previous_seconds, is_reconstructed, is_regression (generated: to_stage.sort_order < from_stage.sort_order)`
**Invariant:** written by the service layer on **every** transition path — edit form, board drag,
API, bulk action, mark-won, mark-lost. There must be exactly one code path that moves a stage.

### deal_outcomes
`deal_id (pk), result (won|lost), reason_id, reason_detail, competitor_name, final_value_minor, currency_code, actual_close_date, closed_by, closed_at`

### outcome_reasons
`id, tenant_id, type (win|loss), label, is_active, sort_order` — tenant-configurable picklist.

## Planning and governance

### quotas
`id, tenant_id, scope (user|team|practice|tenant), scope_ref_id, fiscal_period (e.g. 2026-Q3), target_minor, currency_code, set_by`

### forecast_snapshots
`id, tenant_id, deal_id, snapshot_date, stage_id, forecast_category, weighted_value_minor, owner_id`
Weekly write; the basis of forecast-accuracy reporting.

### leads
`id, tenant_id, company_name, contact_name, email, phone, source_id, campaign, practice_line_id, owner_id, status (new|working|nurturing|qualified|disqualified), disqualification_reason, score, first_engaged_at, converted_deal_id, converted_at`
**Invariant:** unconverted leads are excluded from all pipeline value calculations.

### qualification_answers
`entity_type (lead|deal), entity_id, framework (bant|meddic), field_key, value, updated_by, updated_at`
Completeness is computed, not stored.

### custom_field_defs / custom_field_values
`defs: id, tenant_id, entity_type, label, key, field_type (text|textarea|number|currency|date|dropdown|boolean), options jsonb, help_text, is_required_at_stage_id, sort_order, is_active`
`values: entity_type, entity_id, field_def_id, value_text, value_number, value_date, value_bool`
Typed columns, never a JSON blob, because these must be reportable.

### documents
`id, tenant_id, practice_line_id, deal_id, account_id, contact_id, activity_id, file_name, storage_path, mime_type, size_bytes, document_type (brief|proposal|contract|minutes|other), version_number, supersedes_document_id, uploaded_by`

### automation_rules / automation_runs
`rules: id, tenant_id, name, trigger_type, condition jsonb, actions jsonb, is_active, version, created_by`
`runs: id, rule_id, entity_type, entity_id, fired_at, outcome, error` — every firing traceable from the record.

### notifications
`id, tenant_id, recipient_id, actor_id, event_type, entity_type, entity_id, title, body, read_at, created_at`
Event types include human events (task_assigned, task_reassigned, task_overdue, mentioned,
comment_added, deal_escalated, deal_reassigned, quota_milestone) alongside system events.

### email_connections / email_threads / calendar_events
`connections: user_id, provider (zoho|google|outlook), token_ref (encrypted, server-only), connected_email, scopes, last_sync_at, status`
Thread and event rows link to generated activities and carry an `is_excluded` privacy flag.

### audit_entries  — APPEND-ONLY, NO UPDATE OR DELETE PATH
`id, tenant_id, actor_id, entity_type, entity_id, action, before jsonb, after jsonb, ip_hash, occurred_at`

### currencies / fx_rates
`fx_rates: base_currency, quote_currency, rate, effective_from, source`
Open pipeline converts at current rate; closed deals lock the rate at close date.

## Derived values — never hand-maintained

| Value | Derivation |
|---|---|
| `deals.last_engaged_at` | max `activity_date` where `is_client_facing` and not retracted |
| `deals.engagement_count` | count of non-retracted activities |
| `deals.next_action_task_id` | earliest open task by due date |
| `deals.probability` | stage probability threshold unless explicitly overridden |
| `weighted_value` | value multiplied by probability, computed at query time |
| `days_in_current_stage` | now minus latest stage event `occurred_at` |
| `contacts.last_engaged_at` | max attributed client-facing activity date |
| Qualification completeness | answered required keys over total required keys |
| Attainment | closed-won value in period over quota target |
