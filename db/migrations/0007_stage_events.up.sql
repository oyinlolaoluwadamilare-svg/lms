-- M2.1 (docs/07-build-backlog.md): "stage_events table, immutability triggers, and the
-- regression-derived column." Column list matches db/schema.sql exactly.
--
-- One deliberate deviation from db/schema.sql, called out rather than silently reproduced:
-- docs/01-domain-model.md specifies is_regression as "generated: to_stage.sort_order <
-- from_stage.sort_order" - but Postgres generated columns can only reference other columns of the
-- SAME row, never another table's, so a literal generated column can't compare two different
-- pipeline_stages rows' sort_order. db/schema.sql itself already reflects this reality: it defines
-- is_regression as a plain `boolean not null default false`, not a generated column. This migration
-- follows db/schema.sql's actual column list and instead computes is_regression (and
-- duration_in_previous_seconds) in a BEFORE INSERT trigger - CLAUDE.md #7's "derived fields are
-- computed transactionally on write, never by nightly batch" is satisfied by the trigger being
-- authoritative and running inside the same insert, not by the column being `generated`.
create table stage_events (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  deal_id uuid not null references deals(id),
  from_stage_id uuid references pipeline_stages(id),
  to_stage_id uuid not null references pipeline_stages(id),
  actor_id uuid references users(id),
  occurred_at timestamptz not null default now(),
  duration_in_previous_seconds bigint,
  is_reconstructed boolean not null default false, -- migrated, exclude from cycle-time stats
  is_regression boolean not null default false
);
create index stage_events_deal on stage_events (deal_id, occurred_at);
create index stage_events_funnel on stage_events (tenant_id, to_stage_id, occurred_at);

-- Computes the two derived columns transactionally on insert, the same way migration 0006's
-- set_updated_at_and_by() makes updated_at/updated_by authoritative regardless of what a caller
-- passes - a caller (src/services/stageEvents.ts) never sets these two columns itself.
--
-- duration_in_previous_seconds: only overwritten for a LIVE event (is_reconstructed = false).
-- A future backfill/reconstruction tool (not built - no code path sets is_reconstructed = true
-- yet) supplies its own best-estimate duration for migrated history, which this trigger leaves
-- alone; a live transition always has real prior-event or deal-creation timestamps to compute
-- from, so recomputing it here removes any possibility of the two ever getting out of sync.
--
-- is_regression: always computed, live or reconstructed - it depends only on the two stages'
-- sort_order, not on timing, so there is no "trust the caller" case for it the way there is for
-- duration. A null from_stage_id (no prior stage - not produced by any transition path that exists
-- today, see src/services/stageEvents.ts) has nothing to regress from, so is_regression is false.
create or replace function stage_events_before_insert() returns trigger
language plpgsql as $$
declare
  from_sort_order int;
  to_sort_order int;
  previous_occurred_at timestamptz;
  deal_created_at timestamptz;
begin
  select sort_order into to_sort_order from pipeline_stages where id = new.to_stage_id;

  if new.from_stage_id is not null then
    select sort_order into from_sort_order from pipeline_stages where id = new.from_stage_id;
    new.is_regression := to_sort_order < from_sort_order;
  else
    new.is_regression := false;
  end if;

  if not new.is_reconstructed then
    select occurred_at into previous_occurred_at
      from stage_events where deal_id = new.deal_id
      order by occurred_at desc limit 1;

    if previous_occurred_at is null then
      select created_at into deal_created_at from deals where id = new.deal_id;
      previous_occurred_at := deal_created_at;
    end if;

    new.duration_in_previous_seconds := extract(epoch from (new.occurred_at - previous_occurred_at))::bigint;
  end if;

  return new;
end $$;

create trigger trg_stage_events_before_insert before insert on stage_events
  for each row execute function stage_events_before_insert();

alter table stage_events enable row level security;

-- Read scope mirrors deals_select (migration 0005) exactly: tenant-wide for tenant_admin/executive,
-- practice-entitled otherwise. Deliberately uses the deal_tenant_id()/deal_practice_line_id()
-- security-definer helper functions (migration 0005) rather than db/schema.sql's own literal
-- `exists (select 1 from deals d where d.id = deal_id and ...)` - a raw join from one RLS-enabled
-- table's policy into another RLS-enabled table causes "infinite recursion detected in policy" the
-- moment the two tables' policies both need each other's data (migration 0005's own comment on
-- is_deal_co_owner() documents this exact failure, verified directly on that migration's first RLS
-- test run - not a hypothetical). deal_co_owners_select already established this fix for the same
-- shape of problem; this policy reuses it rather than reintroducing the recursion db/schema.sql's
-- reference kit would hit.
--
-- No insert/update/delete policy for `authenticated` at all - immutable history, written only by
-- the service_role client (src/services/stageEvents.ts), the same pattern audit_entries (migration
-- 0004) already established.
create policy stage_events_select on stage_events for select using (
  deal_tenant_id(deal_id) = current_tenant_id() and (
    has_role('tenant_admin') or has_role('executive')
    or deal_practice_line_id(deal_id) in (select entitled_practices())
  )
);

-- Guard: block any attempt to mutate immutable history, for every role including the table owner
-- and service_role, same reasoning as audit_entries' trg_no_update_audit (migration 0004).
create trigger trg_no_update_stage_events before update or delete on stage_events
  for each statement execute function forbid_mutation();
