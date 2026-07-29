-- M1.1: pipeline_stages, accounts (+ account_practice_owners), deals (+ deal_co_owners) from
-- db/schema.sql, with all constraints including active_deal_requires_owner_and_date.
--
-- Two deliberate deviations from db/schema.sql, called out rather than silently reproduced:
-- 1. db/schema.sql only enables RLS on deals/activities/tasks/stage_events/audit_entries - never
--    on pipeline_stages, accounts, account_practice_owners or deal_co_owners. CLAUDE.md #2 ("every
--    tenant-scoped table has RLS enabled... a table without RLS does not ship") is the highest
--    authority in this repo and applies regardless of what the reference kit shows, so all four
--    get RLS here.
-- 2. docs/01-domain-model.md's own opening line states the general rule "every mutable table
--    carries created_at, updated_at, created_by, updated_by" - but db/schema.sql's own accounts
--    and deals table definitions only include created_by. The general rule wins; updated_by is
--    added to both.

create extension if not exists "pg_trgm"; -- fuzzy duplicate matching (accounts_trgm below)

create type stage_type as enum ('open', 'won', 'lost');
create type deal_status as enum ('active', 'won', 'lost', 'on_hold');
create type client_type as enum ('new', 'existing');
create type forecast_category as enum ('pipeline', 'best_case', 'commit', 'closed');

create table pipeline_stages (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  name text not null, -- renameable
  code text not null, -- IMMUTABLE: history depends on it
  sort_order int not null,
  probability_threshold int not null check (probability_threshold between 0 and 100),
  colour_hex char(7) not null default '#615E56',
  stage_type stage_type not null default 'open',
  is_active boolean not null default true,
  unique (tenant_id, code),
  unique (tenant_id, sort_order)
);
-- exactly one won and one lost stage per tenant
create unique index one_won_stage on pipeline_stages (tenant_id) where stage_type = 'won';
create unique index one_lost_stage on pipeline_stages (tenant_id) where stage_type = 'lost';

-- D-03: an account is one record, but ownership is per practice line (several practice lines may
-- sell into the same client) - see account_practice_owners below. Deliberately no owner_id column.
create table accounts (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  normalised_name text generated always as (lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g'))) stored,
  industry text,
  region text,
  size_band text,
  parent_account_id uuid references accounts(id),
  website text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references users(id),
  updated_by uuid references users(id),
  deleted_at timestamptz
);
create unique index accounts_unique_name on accounts (tenant_id, normalised_name) where deleted_at is null;
create index accounts_trgm on accounts using gin (name gin_trgm_ops); -- fuzzy dup warning

-- D-03: one owner per (account, practice line) relationship, not one global owner. No tenant_id
-- column - RLS below joins through accounts for it.
create table account_practice_owners (
  account_id uuid not null references accounts(id),
  practice_line_id uuid not null references practice_lines(id),
  owner_id uuid not null references users(id),
  added_by uuid references users(id),
  added_at timestamptz not null default now(),
  primary key (account_id, practice_line_id)
);

create table deals (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  reference text not null,
  name text not null,
  account_id uuid not null references accounts(id),
  practice_line_id uuid not null references practice_lines(id),
  stage_id uuid not null references pipeline_stages(id),
  client_type client_type not null,
  lead_source_id uuid,
  owner_id uuid references users(id),
  author_id uuid not null references users(id), -- never null: no "Unknown Author"
  status deal_status not null default 'active',
  proposal_value_minor bigint check (proposal_value_minor >= 0),
  negotiated_value_minor bigint check (negotiated_value_minor >= 0),
  currency_code char(3) not null default 'NGN',
  probability_override int check (probability_override between 0 and 100),
  forecast_category forecast_category not null default 'pipeline',
  forecast_category_override_by uuid references users(id),
  forecast_category_override_reason text,
  expected_close_date date,
  actual_close_date date,
  brief text,
  -- derived, maintained transactionally by triggers/services (M1.2 onward):
  last_engaged_at date,
  last_engaged_activity_id uuid,
  engagement_count int not null default 0,
  next_action_task_id uuid,
  next_action_due_date date,
  risk_score int check (risk_score between 0 and 100),
  risk_factors jsonb,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references users(id),
  updated_by uuid references users(id),
  deleted_at timestamptz,
  unique (tenant_id, reference),
  -- INVARIANT: an active deal must be owned and must have a close date
  constraint active_deal_requires_owner_and_date check (
    status <> 'active' or (owner_id is not null and expected_close_date is not null)
  )
);
create index deals_pipeline on deals (tenant_id, practice_line_id, stage_id) where deleted_at is null;
create index deals_stale on deals (tenant_id, last_engaged_at) where status = 'active' and deleted_at is null;
create index deals_no_next_action on deals (tenant_id) where next_action_task_id is null and status = 'active';

create table deal_co_owners (
  deal_id uuid not null references deals(id),
  user_id uuid not null references users(id),
  added_by uuid references users(id),
  added_at timestamptz not null default now(),
  primary key (deal_id, user_id)
);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- deals_update needs to know if the actor co-owns the deal (deal_co_owners), and
-- deal_co_owners_select/insert need the deal's tenant/practice/owner/author (deals) - each
-- direction needs the other table's RLS-protected data. A raw EXISTS/join against an RLS-enabled
-- table from within another table's policy causes "infinite recursion detected in policy" the
-- moment both directions exist (verified directly - this migration hit it on the first real RLS
-- test run). security definer functions break the cycle by bypassing RLS on the inner lookup only,
-- the same pattern current_tenant_id()/has_role()/entitled_practices() (0003) already use.
create or replace function is_deal_co_owner(p_deal_id uuid) returns boolean
language sql stable security definer as $$
  select exists (select 1 from deal_co_owners where deal_id = p_deal_id and user_id = auth.uid())
$$;

create or replace function deal_tenant_id(p_deal_id uuid) returns uuid
language sql stable security definer as $$
  select tenant_id from deals where id = p_deal_id
$$;

create or replace function deal_practice_line_id(p_deal_id uuid) returns uuid
language sql stable security definer as $$
  select practice_line_id from deals where id = p_deal_id
$$;

create or replace function deal_owner_id(p_deal_id uuid) returns uuid
language sql stable security definer as $$
  select owner_id from deals where id = p_deal_id
$$;

create or replace function deal_author_id(p_deal_id uuid) returns uuid
language sql stable security definer as $$
  select author_id from deals where id = p_deal_id
$$;

-- Same recursion, same fix, for accounts <-> account_practice_owners.
create or replace function account_tenant_id(p_account_id uuid) returns uuid
language sql stable security definer as $$
  select tenant_id from accounts where id = p_account_id
$$;

create or replace function account_has_entitled_practice(p_account_id uuid) returns boolean
language sql stable security definer as $$
  select exists (
    select 1 from account_practice_owners
    where account_id = p_account_id and practice_line_id in (select entitled_practices())
  )
$$;

alter table pipeline_stages          enable row level security;
alter table accounts                 enable row level security;
alter table account_practice_owners  enable row level security;
alter table deals                    enable row level security;
alter table deal_co_owners           enable row level security;

-- Pipeline stages: tenant-wide read (needed for board/table/nav); tenant_admin-only write
-- (docs/02-permission-matrix.md: admin.manage_stages). No delete - reordering/renaming preserves
-- the stable code, is_active retires a stage instead (docs/06-ui-spec.md Admin screen note).
create policy pipeline_stages_select on pipeline_stages for select using (
  tenant_id = current_tenant_id()
);
create policy pipeline_stages_insert on pipeline_stages for insert with check (
  tenant_id = current_tenant_id() and has_role('tenant_admin')
);
create policy pipeline_stages_update on pipeline_stages for update using (
  tenant_id = current_tenant_id() and has_role('tenant_admin')
);

-- Accounts: view/update scope is "practice" (docs/02-permission-matrix.md), but accounts has no
-- practice_line_id of its own (D-03 - ownership is per practice line via
-- account_practice_owners), so "practice" here means "this account has at least one ownership
-- relationship in one of my entitled practices."
create policy accounts_select on accounts for select using (
  tenant_id = current_tenant_id() and deleted_at is null and (
    has_role('tenant_admin') or has_role('executive')
    or account_has_entitled_practice(id)
  )
);
create policy accounts_insert on accounts for insert with check (
  tenant_id = current_tenant_id() and can_write()
);
create policy accounts_update on accounts for update using (
  tenant_id = current_tenant_id() and deleted_at is null and (
    has_role('tenant_admin') or account_has_entitled_practice(id)
  )
);
-- No delete policy: soft delete only, via update setting deleted_at.

create policy account_practice_owners_select on account_practice_owners for select using (
  account_tenant_id(account_id) = current_tenant_id()
  and (has_role('tenant_admin') or has_role('executive') or practice_line_id in (select entitled_practices()))
);
create policy account_practice_owners_insert on account_practice_owners for insert with check (
  account_tenant_id(account_id) = current_tenant_id()
  and can_write()
  and (has_role('tenant_admin') or practice_line_id in (select entitled_practices()))
);
create policy account_practice_owners_update on account_practice_owners for update using (
  account_tenant_id(account_id) = current_tenant_id()
  and can_write()
  and (has_role('tenant_admin') or practice_line_id in (select entitled_practices()))
);
-- No delete policy: reassignment is an update to owner_id, not a delete+insert.

-- Deals: tenant isolation always; practice entitlement for scoped roles (db/schema.sql, unchanged).
create policy deals_select on deals for select using (
  tenant_id = current_tenant_id() and deleted_at is null and (
    has_role('tenant_admin') or has_role('executive')
    or practice_line_id in (select entitled_practices())
  )
);
create policy deals_insert on deals for insert with check (
  tenant_id = current_tenant_id() and can_write() and (
    has_role('tenant_admin') or practice_line_id in (select entitled_practices())
  )
);
create policy deals_update on deals for update using (
  tenant_id = current_tenant_id() and can_write() and (
    has_role('tenant_admin')
    or (has_role('director') and practice_line_id in (select entitled_practices()))
    or (has_role('team_lead') and practice_line_id in (select entitled_practices()))
    or (has_role('bde') and (
          owner_id = auth.uid() or author_id = auth.uid()
          or is_deal_co_owner(id)
       ))
  )
);
-- No delete policy on deals: soft delete only, via an update setting deleted_at.

-- Deal co-owners: same scope shape as deals_update (docs/02-permission-matrix.md:
-- deal.add_co_owner is own/practice/practice/-/tenant, mirroring deal.update exactly).
create policy deal_co_owners_select on deal_co_owners for select using (
  deal_tenant_id(deal_id) = current_tenant_id() and (
    has_role('tenant_admin') or has_role('executive')
    or deal_practice_line_id(deal_id) in (select entitled_practices())
  )
);
create policy deal_co_owners_insert on deal_co_owners for insert with check (
  deal_tenant_id(deal_id) = current_tenant_id() and can_write() and (
    has_role('tenant_admin')
    or (deal_practice_line_id(deal_id) in (select entitled_practices()) and (
          has_role('director') or has_role('team_lead')
          or deal_owner_id(deal_id) = auth.uid() or deal_author_id(deal_id) = auth.uid()
       ))
  )
);
-- No update/delete policy: docs/02-permission-matrix.md has no deal.remove_co_owner action yet -
-- not invented here.
