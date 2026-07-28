-- M0.2: tenants, practice_lines, users, user_roles (docs/01-domain-model.md, db/schema.sql).
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
  id uuid primary key,                       -- mirrors auth.users.id on Supabase
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
    (role in ('director','team_lead','bde') and practice_line_id is not null)
  )
);
create index on user_roles (user_id) where revoked_at is null;
