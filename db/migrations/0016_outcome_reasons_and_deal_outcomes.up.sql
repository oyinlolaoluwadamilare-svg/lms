-- M5.1 (docs/07-build-backlog.md): "`outcome_reasons` admin configuration; `deal_outcomes`
-- migration." First migration of Milestone 5 - db/schema.sql has reference definitions for both
-- tables (lines 108-115, 360-374), but with real gaps this migration deliberately closes rather
-- than reproduces verbatim, the same "found gaps in the reference kit" discipline migration 0005
-- already established for accounts/deals:
--
-- 1. `outcome_reasons.type` is bare `text check (type in ('win','loss'))` in schema.sql, unlike
--    every comparable closed-set column elsewhere in this schema (stage_type, deal_status,
--    task_status, task_priority, activity_type, disposition, client_type, forecast_category,
--    document_type - all real `create type ... as enum`). Fixed here with a proper
--    `outcome_type` enum, for the same reason those already are enums: a closed, small set of
--    values that should be impossible to misspell.
-- 2. `outcome_reasons` has no `created_at`/`updated_at`/`created_by`/`updated_by` at all in
--    schema.sql, unlike `pipeline_stages`' own admin-config sibling - docs/01-domain-model.md's
--    general rule ("every mutable table carries created_at, updated_at, created_by, updated_by")
--    already led migration 0005 to add these to accounts/deals over schema.sql's identical
--    omission there; the same fix applies here, wired to migration 0006's existing
--    `set_updated_at_and_by()` trigger, reused verbatim.
-- 3. `outcome_reasons` has no uniqueness constraint at all in schema.sql, unlike
--    `pipeline_stages`' own `unique (tenant_id, code)` - added here as `unique (tenant_id, type,
--    label)`, the closest equivalent this table has (it carries no separate stable `code` column
--    the way `pipeline_stages` does; nothing in docs/ or the backlog through M5.4 calls for one,
--    and `deal_outcomes.reason_id` already links by uuid, not by label text, so renaming a label
--    later cannot break history the way renaming a stage's own `code` could - not invented here).
-- 4. `deal_outcomes.final_value_minor`/`currency_code` are both nullable in schema.sql (a lost
--    deal plausibly has no final value at all) - kept nullable, but a
--    `final_value_needs_currency` check is added so the pair can never be half-populated (one set,
--    the other null), a small, defensible integrity improvement matching CLAUDE.md #9's "money is
--    never a float" spirit without inventing a new business rule nobody asked for.
--
-- Two decisions this migration deliberately does NOT make, left to the milestones that actually
-- need them, per this codebase's own established "not invented here" discipline:
-- - Nothing in docs/01-domain-model.md, docs/02-permission-matrix.md, docs/04-metric-definitions.md
--   or docs/06-ui-spec.md gives `outcome_reasons` a structural flag for "this loss reason means
--   lost-to-competitor" - M5.2's own backlog line ("lost-to-competitor requires a name") is what
--   will need to decide how a reason is recognised as competitor-shaped (a flag column here, a
--   reserved label string, or something else); this migration only creates the plain
--   `type`/`label`/`is_active`/`sort_order` picklist schema.sql itself documents, nothing more.
-- - `deal_outcomes` gets SELECT and INSERT policies only, no UPDATE/DELETE - `deal_id` is its own
--   primary key (one outcome per deal, ever), and no doc or backlog line through M5.4 names a
--   "revise a recorded outcome" action. CLAUDE.md #4's append-only spirit for engagement history
--   applies at least as strongly to a deal's own permanent closing record; if a correction path is
--   ever needed, it is a new decision for whichever milestone actually asks for one, the same
--   "task_comments.resolved_at had no UPDATE policy until M4.9 specifically named the scope"
--   precedent migration 0011/0015 already established.
--
-- RLS shapes, both mirroring an existing table's scope exactly rather than inventing a new one:
-- `outcome_reasons` mirrors `pipeline_stages` (tenant-wide select, tenant_admin-only insert/update,
-- no delete - deactivate via `is_active`) per docs/02-permission-matrix.md's own
-- `admin.manage_outcome_reasons: tenant` row (bde/team_lead/director/executive all denied write,
-- already wired in src/auth/permissions.ts). `deal_outcomes` mirrors `deals_select`/`deals_update`
-- exactly (via the existing `deal_tenant_id()`/`deal_practice_line_id()`/`deal_owner_id()`/
-- `deal_author_id()`/`is_deal_co_owner()` security-definer helpers, migration 0005) per
-- docs/02-permission-matrix.md's `deal.mark_won`/`deal.mark_lost` rows sharing `deal.update`'s
-- exact own/practice/-/tenant scope - RLS cannot distinguish "closing" from any other
-- deals_update-shaped write any more than it can distinguish deal.update from deal.change_owner
-- (the same documented RLS-granularity limit tests/rls/deals_permission_matrix.spec.ts already
-- found); M5.2's closeDeal service, not yet built, is where that finer distinction will actually
-- be enforced, via can().

create type outcome_type as enum ('win', 'loss');

create table outcome_reasons (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  type outcome_type not null,
  label text not null check (length(btrim(label)) > 0),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id),
  unique (tenant_id, type, label)
);

create trigger outcome_reasons_set_updated_at
  before update on outcome_reasons
  for each row execute function set_updated_at_and_by();

alter table outcome_reasons enable row level security;

create policy outcome_reasons_select on outcome_reasons for select using (
  tenant_id = current_tenant_id()
);
create policy outcome_reasons_insert on outcome_reasons for insert with check (
  tenant_id = current_tenant_id() and has_role('tenant_admin')
);
create policy outcome_reasons_update on outcome_reasons for update using (
  tenant_id = current_tenant_id() and has_role('tenant_admin')
);
-- No delete policy: deactivate via is_active, the same convention pipeline_stages already
-- established (docs/06-ui-spec.md's Admin screen note: "reordering affects reporting" - a deleted
-- reason a historical deal_outcomes row still references by id would break that history outright).

create table deal_outcomes (
  deal_id uuid primary key references deals(id),
  result outcome_type not null,
  reason_id uuid not null references outcome_reasons(id),
  reason_detail text,
  competitor_name text,
  final_value_minor bigint check (final_value_minor >= 0),
  currency_code char(3),
  actual_close_date date not null,
  closed_by uuid not null references users(id),
  closed_at timestamptz not null default now(),
  constraint loss_requires_detail check (
    result <> 'loss' or length(btrim(coalesce(reason_detail, ''))) > 0
  ),
  constraint final_value_needs_currency check (
    (final_value_minor is null) = (currency_code is null)
  )
);

alter table deal_outcomes enable row level security;

create policy deal_outcomes_select on deal_outcomes for select using (
  deal_tenant_id(deal_id) = current_tenant_id() and (
    has_role('tenant_admin') or has_role('executive')
    or deal_practice_line_id(deal_id) in (select entitled_practices())
  )
);
create policy deal_outcomes_insert on deal_outcomes for insert with check (
  deal_tenant_id(deal_id) = current_tenant_id() and can_write() and (
    has_role('tenant_admin')
    or (has_role('director') and deal_practice_line_id(deal_id) in (select entitled_practices()))
    or (has_role('team_lead') and deal_practice_line_id(deal_id) in (select entitled_practices()))
    or (has_role('bde') and (
          deal_owner_id(deal_id) = auth.uid() or deal_author_id(deal_id) = auth.uid()
          or is_deal_co_owner(deal_id)
       ))
  )
);
-- No update/delete policy: see this migration's own header comment - deal_outcomes is meant to be
-- write-once per deal (deal_id is its own primary key), and no revision path is named anywhere yet.
