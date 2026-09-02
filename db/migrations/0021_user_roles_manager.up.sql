-- M6.5 (docs/07-build-backlog.md): "Engagement analytics... all role-scoped." docs/04-metric-
-- definitions.md's own "Engagement coverage" definition is the first metric whose text names a real
-- "team" scope narrower than "practice" ("own deals for a BDE, team for a Team Lead, practice for a
-- Director, tenant for Executive and Tenant Admin") - but nothing in this schema distinguished a
-- Team Lead's team from a Director's practice before this migration; `getTeamOverview` (M4.6) had
-- already documented that gap as "'the team' means every working-role holder in the same practice
-- line(s)" - i.e. team_lead's team and director's practice were the identical set.
--
-- Asked directly rather than resolved silently, in two follow-up rounds: build a real team concept
-- now (a `manager_id` column, not a fixed default the way the M6.3 bottleneck threshold could have
-- been), with a real settings screen (`/admin/team-assignments`) rather than a column-only
-- placeholder, and update `getTeamOverview`'s own already-shipped behavior to match rather than
-- letting "team" mean two different things depending on which screen a Team Lead is looking at.
--
-- Nullable, no cross-tenant default - a bde with no manager assigned yet is simply not on anyone's
-- team roster (their own Team Lead's "team" then reads as just that Team Lead alone, the confirmed
-- fallback - never a misleadingly-inflated practice-wide number standing in for an unconfigured
-- team). Lives on `user_roles`, not `users`, because a manager relationship is a property of ONE
-- role grant (a user could in principle hold more than one row across practice lines, though the
-- role model doesn't expect a bde to); pointing at a specific `user_roles.id` would be more precise
-- still, but `manager_id` referencing `users(id)` directly mirrors every other "who" column already
-- on this table (`granted_by`) and needs no extra join to resolve for the common case.
alter table user_roles add column manager_id uuid references users(id);

-- Validated by a trigger, not a CHECK constraint - the rule spans two rows (this grant's own
-- tenant_id/practice_line_id, and the referenced manager's own role row), which a single-row CHECK
-- cannot express. `security definer`, the same reasoning migration 0018's `validate_deal_contact()`
-- and 0019's `validate_activity_contact()` already established for a cross-row validation trigger:
-- this function's own lookup into `user_roles` must see ground truth regardless of the calling
-- actor's own RLS visibility, not a false "no such team_lead" the caller's own scope would produce.
-- Deliberately narrow: a manager must be an active team_lead in the SAME tenant and practice line as
-- the row being assigned - this milestone only ever sets manager_id on bde-role rows (the new admin
-- screen's own scope), so validating against "team_lead" specifically, not "team_lead or director,"
-- keeps the rule exactly as strict as what's actually being built rather than anticipating a
-- director-reports-to-nobody-yet hierarchy nothing asks for.
create or replace function validate_user_roles_manager() returns trigger
language plpgsql security definer as $$
begin
  if new.manager_id is not null then
    if not exists (
      select 1 from user_roles
      where user_id = new.manager_id
        and tenant_id = new.tenant_id
        and practice_line_id = new.practice_line_id
        and role = 'team_lead'
        and revoked_at is null
    ) then
      raise exception 'manager_id % is not an active team_lead in this tenant/practice line', new.manager_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_validate_user_roles_manager
  before insert or update on user_roles
  for each row execute function validate_user_roles_manager();

-- No RLS change: migration 0003's own `user_roles_update` policy (tenant_admin-only) already covers
-- this column - it has existed since M0.2 with no real caller and no RLS test of its own until this
-- milestone gives it one (`src/services/teamAssignments.ts`, `tests/rls/foundation.spec.ts`), the
-- identical "scaffolded early, closed here" story migration 0020's own `pipeline_stages_update` gap
-- just told.
create index user_roles_manager on user_roles (manager_id) where revoked_at is null;
