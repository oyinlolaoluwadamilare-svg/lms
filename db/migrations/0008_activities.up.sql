-- M3.1: activities, activity_revisions, with the future-date constraint, the generated
-- is_client_facing column, and stage_id_at_time capture.
--
-- One deliberate deviation from docs/07-build-backlog.md's literal M3.1 task list, called out
-- rather than silently worked around: it also names activity_contacts, but that table's
-- contact_id references contacts(id) - and contacts (M5.5) does not exist yet in this codebase
-- (only deals/pipeline_stages/accounts exist so far). A table cannot reference a table that isn't
-- there; activity_contacts is deferred to M5.7 ("Activity attribution to contacts"), which is
-- explicitly the same deliverable under a different name, scheduled after contacts actually
-- exists. Not invented around with a placeholder FK or a nullable-and-unenforced column - simply
-- not created until its dependency is real.
--
-- Also deliberately excluded, matching docs/07-build-backlog.md's own M3.1/M3.2 split rather than
-- db/schema.sql's grouping: the last_engaged_at/engagement_count-maintaining trigger
-- (refresh_deal_engagement() in db/schema.sql) is M3.2's job ("logActivity service:  the single
-- creation path, deriving last_engaged_at, engagement_count... in one transaction") - this
-- migration only creates the table structure, not the cross-table derived-field maintenance.

create type activity_type as enum (
  'note', 'call', 'email', 'meeting', 'follow_up', 'site_visit', 'proposal_walkthrough', 'internal_review'
);
create type activity_source as enum ('manual', 'email_sync', 'calendar_sync', 'migration');
create type disposition as enum ('positive', 'neutral', 'negative', 'no_response');

create table activities (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  deal_id uuid references deals(id),
  account_id uuid references accounts(id),
  type activity_type not null,
  is_client_facing boolean generated always as (
    type in ('call', 'email', 'meeting', 'site_visit', 'proposal_walkthrough', 'follow_up')
  ) stored,
  activity_date date not null,
  summary text not null check (length(btrim(summary)) > 0),
  outcome text,
  outcome_disposition disposition,
  stage_id_at_time uuid references pipeline_stages(id), -- captured on insert; backdating stays attributable
  author_id uuid not null references users(id),
  source activity_source not null default 'manual',
  edit_locked_at timestamptz not null default (now() + interval '24 hours'),
  retracted_at timestamptz,
  retracted_by uuid references users(id),
  retraction_reason text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  -- an engagement cannot have happened in the future: that is a Task, not an Activity
  constraint activity_date_not_future check (activity_date <= current_date),
  constraint retraction_needs_reason check (
    retracted_at is null or (retracted_by is not null and length(btrim(coalesce(retraction_reason, ''))) > 0)
  )
);
create index activities_deal_timeline on activities (deal_id, activity_date desc) where retracted_at is null;
create index activities_author_period on activities (tenant_id, author_id, activity_date);

-- activity_date_not_future's `current_date` is evaluated in Postgres's own session timezone (UTC on
-- this project), not the acting user's - the same class of imprecision CLAUDE.md #8 exists to
-- prevent (a WAT user's "today" can already be one calendar day ahead of UTC's). This check stays
-- as a coarse, defense-in-depth backstop only (it still rejects anything clearly in the future);
-- the PRECISE check, in the actor's own resolved timezone via src/lib/dates.ts, is logActivity's
-- job (M3.2) - the same "RLS is a second, independent control, never the only one" layering
-- CLAUDE.md #1 already establishes for authorisation applies here to date validation too.

create table activity_revisions (
  id uuid primary key default uuid_generate_v4(),
  activity_id uuid not null references activities(id),
  field_name text not null,
  previous_value text,
  new_value text,
  changed_by uuid not null references users(id),
  changed_at timestamptz not null default now()
);

-- Authoritative regardless of what a caller passes for stage_id_at_time - the same
-- trigger-is-authoritative pattern migration 0006 (updated_at/updated_by) and migration 0007
-- (duration_in_previous_seconds/is_regression) already established. A null deal_id (an
-- account-only activity - no code path creates one yet, but the column stays nullable per the
-- domain model) simply leaves stage_id_at_time null; there is no stage to attribute to.
create or replace function activities_before_insert() returns trigger
language plpgsql as $$
begin
  if new.deal_id is not null then
    select stage_id into new.stage_id_at_time from deals where id = new.deal_id;
  end if;
  return new;
end $$;

create trigger trg_activities_before_insert before insert on activities
  for each row execute function activities_before_insert();

alter table activities enable row level security;
alter table activity_revisions enable row level security;

-- Read/write scope mirrors deals exactly (docs/02-permission-matrix.md's activity.* rows): practice
-- for bde/team_lead/director, tenant-wide for executive (D-06: full narratives, not just
-- aggregates) and tenant_admin. Reuses migration 0005's deal_practice_line_id()/deal_owner_id()/
-- deal_author_id()/is_deal_co_owner() security-definer helpers rather than a raw join to deals -
-- the same cross-table RLS recursion migration 0005 found and fixed for deal_co_owners applies
-- here too (activities' own policies need deals' data). Unlike stage_events/deal_co_owners,
-- activities carries its own tenant_id column, so the tenant check is a direct column comparison,
-- not a deal_tenant_id() lookup.
create policy activities_select on activities for select using (
  tenant_id = current_tenant_id() and (
    has_role('tenant_admin') or has_role('executive')
    or (deal_id is not null and deal_practice_line_id(deal_id) in (select entitled_practices()))
  )
);

-- activity.create: own (bde - the underlying deal's owner/co-owner/author), practice (team_lead,
-- director), tenant (tenant_admin), denied (executive - can_write() already excludes them). Mirrors
-- deals_update's bde branch exactly, since "own" here is about the DEAL's ownership, not anything
-- on the activity itself (docs/02-permission-matrix.md's "own = owner, co-owner or author").
create policy activities_insert on activities for insert with check (
  tenant_id = current_tenant_id() and can_write() and deal_id is not null and (
    has_role('tenant_admin')
    or ((has_role('director') or has_role('team_lead')) and deal_practice_line_id(deal_id) in (select entitled_practices()))
    or (has_role('bde') and (
          deal_owner_id(deal_id) = auth.uid() or deal_author_id(deal_id) = auth.uid()
          or is_deal_co_owner(deal_id)
       ))
  )
);

-- activity.update (own, within 24h): uniformly "own" for every role including tenant_admin - unlike
-- deals, no role may edit ANOTHER user's activity at all, ever (docs/01-domain-model.md: "Editable
-- by the author only until edit_locked_at"). Correction of someone else's activity is `activity.retract`
-- (director/tenant_admin only) - a materially different, broader permission this policy does not
-- grant. Known gap, flagged rather than silently deferred: retraction (M3.6) will need its own write
-- path, since a plain USING clause here cannot distinguish "the author editing summary/outcome"
-- from "a director setting retracted_at" any more than deals_update can distinguish change_stage
-- from change_owner (tests/rls/deals_permission_matrix.spec.ts's own documented finding) - M3.6's
-- retractActivity service will need a service-role client, the same shape changeStage/writeAudit
-- already use for privileged single-path writes, not an extension of this policy.
create policy activities_update on activities for update using (
  tenant_id = current_tenant_id() and can_write() and author_id = auth.uid() and now() < edit_locked_at
);

-- No delete policy on activities: APPEND-ONLY (CLAUDE.md #3), and docs/02-permission-matrix.md's
-- activity.delete row is "no role, ever."

-- activity_revisions: same read scope as activities (a revision is only meaningful in the context
-- of the activity it belongs to), via the same deal_practice_line_id() lookup one level removed
-- (through activity_id -> activities.deal_id). No insert/update/delete policy for `authenticated`
-- at all - written only by the service layer when M3.6's edit path exists, the same immutable-
-- ledger shape audit_entries/stage_events already established, enforced the same way: forbid_mutation.
create policy activity_revisions_select on activity_revisions for select using (
  exists (
    select 1 from activities a
    where a.id = activity_id and a.tenant_id = current_tenant_id() and (
      has_role('tenant_admin') or has_role('executive')
      or (a.deal_id is not null and deal_practice_line_id(a.deal_id) in (select entitled_practices()))
    )
  )
);

create trigger trg_no_update_activity_revisions before update or delete on activity_revisions
  for each statement execute function forbid_mutation();
