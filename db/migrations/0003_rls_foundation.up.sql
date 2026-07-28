-- M0.2: RLS helper functions (docs/02-permission-matrix.md, docs/03-architecture.md) plus RLS on
-- the four foundation tables. Every later migration that adds a tenant-scoped table must ship its
-- own RLS policies in the same migration — a table without RLS does not ship (CLAUDE.md #2).
--
-- These functions are security definer and owned by the migration role, which also owns the
-- tables, so their internal lookups bypass RLS (this is the same pattern Supabase's own auth.*
-- helpers use). On real Supabase, auth.uid() and auth.users already exist and this file does not
-- redefine them; locally, tests/rls/fixtures/local_auth_shim.sql provides a compatible stand-in.

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
      or has_role('team_lead')   or has_role('bde')
$$;

alter table tenants        enable row level security;
alter table practice_lines enable row level security;
alter table users          enable row level security;
alter table user_roles     enable row level security;

-- Tenants: a user reads only their own tenant row. No insert/update/delete policy for the
-- application role at all - tenant provisioning is a platform/out-of-band operation, matching
-- the permission matrix (there is no "tenant.create" action for any role).
create policy tenants_select on tenants for select using (
  id = current_tenant_id()
);

-- Practice lines: any tenant member reads all practice lines in the tenant (needed for nav,
-- assignment pickers); only tenant_admin writes (admin.manage_practice_lines).
create policy practice_lines_select on practice_lines for select using (
  tenant_id = current_tenant_id() and deleted_at is null
);
create policy practice_lines_insert on practice_lines for insert with check (
  tenant_id = current_tenant_id() and has_role('tenant_admin')
);
create policy practice_lines_update on practice_lines for update using (
  tenant_id = current_tenant_id() and has_role('tenant_admin')
);
-- No delete policy: soft delete only, via update setting deleted_at.

-- Users: any tenant member reads tenant colleagues (assignee pickers, @mentions, team views).
-- Writes: tenant_admin always; a user may also update their own row (profile fields).
-- NOTE: this does not yet restrict which *columns* a self-update may touch (e.g. a user
-- self-updating should not be able to change their own status or tenant_id) - that needs a
-- trigger or application-layer check when the profile-edit feature (M0.7) is built. Flagging
-- here rather than silently relying on RLS for something it does not fully cover.
-- NOTE: the delegated "Team Lead practice invites" toggle (capability C3) is not modelled by
-- this migration (no tenant-settings table exists yet in this slice); when it is built, the
-- insert policy below will need a conditional branch for team_lead. Left as tenant_admin-only
-- until then rather than guessing the toggle's storage shape.
create policy users_select on users for select using (
  tenant_id = current_tenant_id() and deleted_at is null
);
create policy users_insert on users for insert with check (
  tenant_id = current_tenant_id() and has_role('tenant_admin')
);
create policy users_update on users for update using (
  tenant_id = current_tenant_id() and (has_role('tenant_admin') or id = auth.uid())
);
-- No delete policy: soft delete only, via update setting deleted_at.

-- User roles: tenant-wide read (role visibility is coarse-grained, not itself sensitive);
-- only tenant_admin grants or revokes (admin.assign_role is tenant_admin-only for every role).
create policy user_roles_select on user_roles for select using (
  tenant_id = current_tenant_id()
);
create policy user_roles_insert on user_roles for insert with check (
  tenant_id = current_tenant_id() and has_role('tenant_admin')
);
create policy user_roles_update on user_roles for update using (
  tenant_id = current_tenant_id() and has_role('tenant_admin')
);
-- No delete policy: a grant is revoked via update setting revoked_at, never removed.
