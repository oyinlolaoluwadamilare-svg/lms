-- ============================================================================
-- Pipeline Intelligence — canonical schema (excerpt: core + execution layer)
-- PostgreSQL / Supabase. Milestones 0-3.
-- Claude Code: split into sequential migrations under /db/migrations.
-- Every statement below is intentional. Do not "simplify" the constraints.
-- ============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm";      -- fuzzy duplicate matching
create extension if not exists "citext";        -- case-insensitive email

-- ---------------------------------------------------------------- enums
create type user_status      as enum ('active','pending','suspended','inactive');
create type app_role         as enum ('tenant_admin','executive','director','team_lead','bdm');
create type stage_type       as enum ('open','won','lost');
create type deal_status      as enum ('active','won','lost','on_hold');
create type client_type      as enum ('new','existing');
create type forecast_category as enum ('pipeline','best_case','commit','closed');
create type activity_type    as enum ('note','call','email','meeting','follow_up',
                                      'site_visit','proposal_walkthrough','internal_review');
create type activity_source  as enum ('manual','email_sync','calendar_sync','migration');
create type disposition      as enum ('positive','neutral','negative','no_response');
create type task_status      as enum ('open','in_progress','blocked','done','cancelled');
create type task_priority    as enum ('low','normal','high','urgent');
create type decision_role    as enum ('champion','economic_buyer','influencer',
                                      'technical_evaluator','procurement','blocker','unknown');

-- ---------------------------------------------------------------- tenancy
create table tenants (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug citext not null unique,
  plan_tier text not null default 'standard',
  seat_limit int not null default 25 check (seat_limit > 0),
  reporting_currency char(3) not null default 'NGN',
  fiscal_year_start_month int not null default 1 check (fiscal_year_start_month between 1 and 12),
  timezone text not null default 'Africa/Lagos',
  date_format text not null default 'DD/MM/YYYY',
  logo_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table practice_lines (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  code text not null,
  region text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz,
  unique (tenant_id, code)
);

create table users (
  id uuid primary key,                       -- mirrors auth.users.id
  tenant_id uuid not null references tenants(id),
  full_name text not null,
  email citext not null,
  department text,
  job_title text,
  timezone text,
  date_format text,
  avatar_url text,
  status user_status not null default 'pending',
  last_active_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, email)
);

create table user_roles (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id),
  role app_role not null,
  practice_line_id uuid references practice_lines(id),
  granted_by uuid references users(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  -- tenant-wide roles must NOT be scoped to a practice; scoped roles MUST be
  constraint role_scope_valid check (
    (role in ('tenant_admin','executive') and practice_line_id is null) or
    (role in ('director','team_lead','bdm') and practice_line_id is not null)
  )
);
create index on user_roles (user_id) where revoked_at is null;

-- ---------------------------------------------------------------- config
create table pipeline_stages (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  name text not null,                         -- renameable
  code text not null,                         -- IMMUTABLE: history depends on it
  sort_order int not null,
  probability_threshold int not null check (probability_threshold between 0 and 100),
  colour_hex char(7) not null default '#615E56',
  stage_type stage_type not null default 'open',
  is_active boolean not null default true,
  unique (tenant_id, code),
  unique (tenant_id, sort_order)
);
-- exactly one won and one lost stage per tenant
create unique index one_won_stage  on pipeline_stages (tenant_id) where stage_type = 'won';
create unique index one_lost_stage on pipeline_stages (tenant_id) where stage_type = 'lost';

create table outcome_reasons (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  type text not null check (type in ('win','loss')),
  label text not null,
  sort_order int not null default 0,
  is_active boolean not null default true
);

-- ---------------------------------------------------------------- accounts / contacts
create table accounts (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  normalised_name text generated always as (lower(regexp_replace(name,'[^a-zA-Z0-9]','','g'))) stored,
  industry text, region text, size_band text,
  parent_account_id uuid references accounts(id),
  website text,
  owner_id uuid references users(id),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references users(id),
  deleted_at timestamptz
);
create unique index accounts_unique_name on accounts (tenant_id, normalised_name) where deleted_at is null;
create index accounts_trgm on accounts using gin (name gin_trgm_ops);   -- fuzzy dup warning

create table contacts (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  account_id uuid not null references accounts(id),
  first_name text not null,
  last_name text,
  job_title text,
  email citext,
  phone text,
  linkedin_url text,
  is_active boolean not null default true,
  last_engaged_at date,                        -- DERIVED, written transactionally
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------- deals
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
  author_id uuid not null references users(id),   -- never null: no "Unknown Author"
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
  -- derived, maintained transactionally by triggers/services:
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

create table deal_contacts (
  deal_id uuid not null references deals(id),
  contact_id uuid not null references contacts(id),
  decision_role decision_role not null default 'unknown',
  is_primary boolean not null default false,
  added_by uuid references users(id),
  added_at timestamptz not null default now(),
  primary key (deal_id, contact_id)
);
create unique index one_primary_contact on deal_contacts (deal_id) where is_primary;

-- ================================================================
-- EXECUTION LAYER — the reason this product exists
-- ================================================================

create table activities (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  deal_id uuid references deals(id),
  account_id uuid references accounts(id),
  type activity_type not null,
  is_client_facing boolean generated always as (
    type in ('call','email','meeting','site_visit','proposal_walkthrough','follow_up')
  ) stored,
  activity_date date not null,
  summary text not null check (length(btrim(summary)) > 0),
  outcome text,
  outcome_disposition disposition,
  stage_id_at_time uuid references pipeline_stages(id),   -- backdating stays attributable
  author_id uuid not null references users(id),
  source activity_source not null default 'manual',
  edit_locked_at timestamptz not null default (now() + interval '24 hours'),
  retracted_at timestamptz,
  retracted_by uuid references users(id),
  retraction_reason text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  -- an engagement cannot have happened in the future: that is a Task
  constraint activity_date_not_future check (activity_date <= current_date),
  constraint retraction_needs_reason check (
    retracted_at is null or (retracted_by is not null and length(btrim(coalesce(retraction_reason,''))) > 0)
  )
);
create index activities_deal_timeline on activities (deal_id, activity_date desc) where retracted_at is null;
create index activities_author_period on activities (tenant_id, author_id, activity_date);

create table activity_revisions (
  id uuid primary key default uuid_generate_v4(),
  activity_id uuid not null references activities(id),
  field_name text not null,
  previous_value text,
  new_value text,
  changed_by uuid not null references users(id),
  changed_at timestamptz not null default now()
);

create table activity_contacts (
  activity_id uuid not null references activities(id),
  contact_id uuid not null references contacts(id),
  primary key (activity_id, contact_id)
);

create table tasks (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  deal_id uuid references deals(id),
  account_id uuid references accounts(id),
  contact_id uuid references contacts(id),
  origin_activity_id uuid references activities(id),
  title text not null check (length(btrim(title)) > 0),
  description text,
  assignee_id uuid not null references users(id),
  assigned_by uuid not null references users(id),
  due_date date not null,
  due_time time,
  priority task_priority not null default 'normal',
  status task_status not null default 'open',
  blocked_reason text,
  snooze_count int not null default 0,
  completed_at timestamptz,
  completed_by uuid references users(id),
  template_item_id uuid,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint blocked_needs_reason check (
    status <> 'blocked' or length(btrim(coalesce(blocked_reason,''))) > 0
  ),
  constraint done_needs_completion check (
    status <> 'done' or (completed_at is not null and completed_by is not null)
  )
);
create index tasks_my_work on tasks (assignee_id, due_date) where status in ('open','in_progress','blocked');
create index tasks_delegated on tasks (assigned_by, status);
create index tasks_overdue on tasks (tenant_id, due_date) where status in ('open','in_progress');

create table task_assignments (
  id uuid primary key default uuid_generate_v4(),
  task_id uuid not null references tasks(id),
  from_user_id uuid references users(id),
  to_user_id uuid not null references users(id),
  assigned_by uuid not null references users(id),
  assigned_at timestamptz not null default now()
);

create table task_comments (
  id uuid primary key default uuid_generate_v4(),
  task_id uuid not null references tasks(id),
  author_id uuid not null references users(id),
  body text not null,
  resolved_at timestamptz,
  resolved_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table task_watchers (
  task_id uuid not null references tasks(id),
  user_id uuid not null references users(id),
  added_by uuid references users(id),
  added_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

-- IMMUTABLE: the source of truth for funnel, velocity and cycle time
create table stage_events (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  deal_id uuid not null references deals(id),
  from_stage_id uuid references pipeline_stages(id),
  to_stage_id uuid not null references pipeline_stages(id),
  actor_id uuid references users(id),
  occurred_at timestamptz not null default now(),
  duration_in_previous_seconds bigint,
  is_reconstructed boolean not null default false,   -- migrated, exclude from cycle-time stats
  is_regression boolean not null default false
);
create index stage_events_deal on stage_events (deal_id, occurred_at);
create index stage_events_funnel on stage_events (tenant_id, to_stage_id, occurred_at);

create table deal_outcomes (
  deal_id uuid primary key references deals(id),
  result text not null check (result in ('won','lost')),
  reason_id uuid not null references outcome_reasons(id),
  reason_detail text,
  competitor_name text,
  final_value_minor bigint,
  currency_code char(3),
  actual_close_date date not null,
  closed_by uuid not null references users(id),
  closed_at timestamptz not null default now(),
  constraint loss_requires_detail check (
    result <> 'lost' or length(btrim(coalesce(reason_detail,''))) > 0
  )
);

-- APPEND-ONLY. No update or delete policy is ever granted on this table.
create table audit_entries (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id),
  actor_id uuid references users(id),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  before jsonb,
  after jsonb,
  ip_hash text,
  occurred_at timestamptz not null default now()
);
create index audit_lookup on audit_entries (tenant_id, entity_type, entity_id, occurred_at desc);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

create or replace function current_tenant_id() returns uuid
language sql stable security definer as $$
  select tenant_id from users where id = auth.uid() and deleted_at is null and status = 'active'
$$;

create or replace function has_role(r app_role) returns boolean
language sql stable security definer as $$
  select exists (
    select 1 from user_roles ur join users u on u.id = ur.user_id
    where ur.user_id = auth.uid() and ur.role = r and ur.revoked_at is null
      and u.status = 'active' and u.deleted_at is null
  )
$$;

create or replace function entitled_practices() returns setof uuid
language sql stable security definer as $$
  select ur.practice_line_id from user_roles ur join users u on u.id = ur.user_id
  where ur.user_id = auth.uid() and ur.revoked_at is null
    and u.status = 'active' and u.deleted_at is null
    and ur.practice_line_id is not null
$$;

create or replace function can_write() returns boolean
language sql stable security definer as $$
  -- executive is read-only, enforced here and not merely in the UI
  select has_role('tenant_admin') or has_role('director')
      or has_role('team_lead')   or has_role('bdm')
$$;

alter table deals      enable row level security;
alter table activities enable row level security;
alter table tasks      enable row level security;
alter table stage_events enable row level security;
alter table audit_entries enable row level security;
-- (repeat for every tenant-scoped table; a table without RLS does not ship)

-- Deals: tenant isolation always; practice entitlement for scoped roles
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
    or (has_role('bdm') and (
          owner_id = auth.uid() or author_id = auth.uid()
          or exists (select 1 from deal_co_owners c where c.deal_id = id and c.user_id = auth.uid())
       ))
  )
);
-- NOTE: no delete policy on deals. Soft delete only, via an update setting deleted_at.

-- Activities: THE regression guard — a bdm must be able to insert on their own deal
create policy activities_insert on activities for insert with check (
  tenant_id = current_tenant_id() and can_write() and exists (
    select 1 from deals d where d.id = deal_id and d.tenant_id = current_tenant_id() and (
      has_role('tenant_admin')
      or (d.practice_line_id in (select entitled_practices()) and (
            has_role('director') or has_role('team_lead')
            or d.owner_id = auth.uid() or d.author_id = auth.uid()
            or exists (select 1 from deal_co_owners c where c.deal_id = d.id and c.user_id = auth.uid())
         ))
    )
  )
);

create policy activities_select on activities for select using (
  tenant_id = current_tenant_id() and (
    has_role('tenant_admin')
    or has_role('executive')     -- pending decision D-06
    or exists (select 1 from deals d where d.id = deal_id
               and d.practice_line_id in (select entitled_practices()))
  )
);

-- Author may correct their own entry only inside the edit window. Nobody edits another's.
create policy activities_update on activities for update using (
  tenant_id = current_tenant_id() and can_write()
  and author_id = auth.uid() and now() < edit_locked_at and retracted_at is null
);
-- NO delete policy on activities, for any role, ever.

-- Tasks: assignee, assigner, and practice leadership
create policy tasks_select on tasks for select using (
  tenant_id = current_tenant_id() and deleted_at is null and (
    has_role('tenant_admin') or has_role('executive')
    or assignee_id = auth.uid() or assigned_by = auth.uid()
    or exists (select 1 from deals d where d.id = deal_id
               and d.practice_line_id in (select entitled_practices()))
  )
);

create policy tasks_insert on tasks for insert with check (
  tenant_id = current_tenant_id() and can_write() and (
    has_role('tenant_admin')
    or deal_id is null
    or exists (select 1 from deals d where d.id = deal_id
               and d.tenant_id = current_tenant_id()
               and d.practice_line_id in (select entitled_practices()))
  )
);

create policy tasks_update on tasks for update using (
  tenant_id = current_tenant_id() and can_write() and (
    has_role('tenant_admin') or assignee_id = auth.uid() or assigned_by = auth.uid()
    or exists (select 1 from deals d where d.id = deal_id
               and d.practice_line_id in (select entitled_practices())
               and (has_role('director') or has_role('team_lead')))
  )
);

-- Immutable tables: select only. No insert policy for clients either — service role writes them.
create policy stage_events_select on stage_events for select using (
  tenant_id = current_tenant_id() and exists (
    select 1 from deals d where d.id = deal_id and (
      has_role('tenant_admin') or has_role('executive')
      or d.practice_line_id in (select entitled_practices())
    )
  )
);

create policy audit_select on audit_entries for select using (
  tenant_id = current_tenant_id() and (has_role('tenant_admin') or has_role('executive') or has_role('director'))
);
-- No insert/update/delete policies: written by the service role only, never mutated.

-- ============================================================================
-- Derived-field maintenance: transactional, never batch
-- ============================================================================

create or replace function refresh_deal_engagement() returns trigger
language plpgsql security definer as $$
begin
  update deals d set
    last_engaged_at = sub.max_date,
    last_engaged_activity_id = sub.latest_id,
    engagement_count = sub.total,
    updated_at = now()
  from (
    select
      max(a.activity_date) filter (where a.is_client_facing) as max_date,
      (select id from activities x
        where x.deal_id = coalesce(new.deal_id, old.deal_id)
          and x.is_client_facing and x.retracted_at is null
        order by x.activity_date desc, x.created_at desc limit 1) as latest_id,
      count(*) filter (where a.retracted_at is null) as total
    from activities a
    where a.deal_id = coalesce(new.deal_id, old.deal_id) and a.retracted_at is null
  ) sub
  where d.id = coalesce(new.deal_id, old.deal_id);
  return null;
end $$;

create trigger trg_activity_refresh
  after insert or update on activities
  for each row execute function refresh_deal_engagement();

create or replace function refresh_deal_next_action() returns trigger
language plpgsql security definer as $$
begin
  update deals d set
    next_action_task_id = sub.id,
    next_action_due_date = sub.due_date,
    updated_at = now()
  from (
    select id, due_date from tasks
    where deal_id = coalesce(new.deal_id, old.deal_id)
      and status in ('open','in_progress','blocked') and deleted_at is null
    order by due_date asc limit 1
  ) sub
  where d.id = coalesce(new.deal_id, old.deal_id);
  return null;
end $$;

create trigger trg_task_refresh
  after insert or update or delete on tasks
  for each row execute function refresh_deal_next_action();

-- Guard: block any attempt to mutate immutable history
create or replace function forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'Table % is append-only and cannot be modified', tg_table_name;
end $$;

create trigger trg_no_update_stage_events before update or delete on stage_events
  for each statement execute function forbid_mutation();
create trigger trg_no_update_audit before update or delete on audit_entries
  for each statement execute function forbid_mutation();
