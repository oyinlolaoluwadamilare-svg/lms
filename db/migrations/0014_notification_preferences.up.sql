-- M4.8 (docs/07-build-backlog.md): "Notification events for assigned, reassigned, overdue and
-- mentioned, with per-type user preferences replacing coarse toggles." task_assigned and
-- task_reassigned already fire (M4.2, migration 0012) - what was missing is the per-user,
-- per-event-type preference gating every notification, plus task_overdue itself (the first
-- background job in this codebase) and scaffolding for `mentioned`.
--
-- Several decisions here have no doc to point to and were made by explicit user choice rather than
-- silently assumed, recorded here so they aren't re-litigated later:
--
-- - "coarse toggles", this backlog line's own wording, has no existing artifact anywhere in this
--   codebase to replace - there was never a blanket on/off notification switch shipped before this.
--   This preference model is authored from scratch, not a migration off something that existed.
-- - Default is ON: a MISSING notification_preferences row means "enabled" (see the gate/sweep logic
--   below) - a user only gets a row once they've actually turned a preference off (or back on after
--   that), the same "absence means the default" reasoning src/data/users.ts's own timezone-falls-
--   back-to-tenant already uses. This is also why there is no seed/backfill step here inserting one
--   row per existing user per event type - it would be redundant with the default.
-- - `mentioned` is added to the set of event types a user CAN set a preference for, even though
--   nothing can fire it yet - task_comments (migration 0011) has no service-layer code at all today,
--   and M4.9 ("Comments, watchers and @mention") is what will add the one insertNotification call
--   site that actually sends it. The preference model is complete now; M4.9 only has to add that
--   one call, gated the same way task_assigned/task_reassigned already are.
-- - task_overdue fires ONCE per task, the moment it first becomes overdue - never repeatedly for
--   the same task. Enforced two ways: the sweep's own `not exists` check below (so it never even
--   attempts a duplicate insert), and a partial unique index on notifications(entity_id) where
--   event_type = 'task_overdue' as a hard backstop against any future concurrent-sweep race.
-- - The sweep's own status filter is `('open', 'in_progress')`, deliberately excluding 'blocked' -
--   matching migration 0011's own pre-built `tasks_overdue` partial index exactly (its predicate
--   already excludes 'blocked', unlike the broader `tasks_my_work` index), and product-defensible on
--   its own terms: a blocked task is blocked on something outside its assignee's control, so nagging
--   them with an overdue notification about it is noise, not signal. Worth flagging plainly rather
--   than silently: src/domain/task.ts's own taskQueueGroup has no such carve-out - a blocked,
--   past-due task still visually sits in My Work's "Overdue" bucket today. That UI grouping and this
--   proactive notification are different concerns answering different questions ("what needs my
--   attention right now" vs. "alert me the moment something crosses its deadline"), so the two
--   disagreeing here is a deliberate scope note, not a bug to reconcile.
-- - The sweep runs via pg_cron, per CLAUDE.md's stated architecture ("Queue-backed jobs (Supabase
--   cron plus a job table)") - but this specific job needs no separate job-tracking table of its
--   own: notifications' own (entity_id, event_type) pair already IS the idempotency ledger, and the
--   sweep is a single atomic `insert ... select ...` statement, not a multi-step process that could
--   fail partway - a missed or failed run is simply caught by the next scheduled run finding the
--   same still-unswept, still-overdue tasks. A generic job-queue table would be premature
--   abstraction for a job this simple (CLAUDE.md #6's "no premature abstraction").
-- - pg_cron is not installed at all on the local Postgres this repository's RLS suite runs
--   against (this sandbox also has no raw-TCP egress to verify it any other way against the real
--   hosted project directly) - the schedule-registration step below is wrapped so it no-ops locally
--   rather than failing this entire migration, and actually registers the schedule wherever pg_cron
--   IS available. Every 15 minutes is a judgment call, not a documented requirement - close enough
--   to real-time for an overdue notification to feel timely, without sweeping on every request.

create table notification_preferences (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id),
  event_type text not null check (length(btrim(event_type)) > 0),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, event_type)
);

alter table notification_preferences enable row level security;

create policy notification_preferences_select on notification_preferences for select using (
  tenant_id = current_tenant_id() and user_id = auth.uid()
);
-- Insert AND update (rather than insert-then-always-update) because the UI's natural shape is an
-- upsert - a user's first-ever toggle of a given event type has no existing row to update yet.
create policy notification_preferences_upsert on notification_preferences for insert with check (
  tenant_id = current_tenant_id() and user_id = auth.uid()
);
create policy notification_preferences_update on notification_preferences for update using (
  tenant_id = current_tenant_id() and user_id = auth.uid()
);
-- No delete policy: "turn back on" is another upsert (enabled = true), never a row removal - the
-- absence-means-default reasoning above only needs insert/update to fully express every state a
-- user can put their own preference in, the same reasoning migration 0012 already gives for why
-- notifications itself has no delete policy for anyone (CLAUDE.md #3).

-- Once-per-task backstop for the overdue sweep below (see this migration's header comment).
create unique index notifications_task_overdue_once on notifications (entity_id) where event_type = 'task_overdue';

-- M4.8's overdue sweep. "Today" is resolved per-tenant via tenants.timezone (CLAUDE.md #8) rather
-- than Postgres's own session timezone (UTC) - unlike migration 0008's activity_date_not_future,
-- whose own comment explains that check can tolerate a coarse, UTC-evaluated "today" because it is
-- only a defense-in-depth backstop, THIS is the authoritative trigger for a real user-facing
-- notification, so the per-tenant day boundary actually matters here.
create or replace function sweep_overdue_tasks() returns void
language sql
security definer
as $$
  insert into notifications (tenant_id, recipient_id, actor_id, event_type, entity_type, entity_id, title)
  select
    t.tenant_id,
    t.assignee_id,
    null,
    'task_overdue',
    'task',
    t.id,
    'A task is overdue'
  from tasks t
  join tenants tn on tn.id = t.tenant_id
  where t.deleted_at is null
    and t.status in ('open', 'in_progress')
    and t.due_date < (now() at time zone tn.timezone)::date
    and not exists (
      select 1 from notifications n where n.entity_id = t.id and n.event_type = 'task_overdue'
    )
    and coalesce(
      (select np.enabled from notification_preferences np where np.user_id = t.assignee_id and np.event_type = 'task_overdue'),
      true
    )
  on conflict (entity_id) where event_type = 'task_overdue' do nothing;
$$;

-- Registers the recurring schedule wherever pg_cron is actually available (the real hosted
-- Supabase project); no-ops locally, where the extension isn't installed at all, rather than
-- failing this entire migration.
do $$
begin
  execute 'create extension if not exists pg_cron';
exception when others then
  raise notice 'pg_cron unavailable in this environment - overdue sweep is not scheduled (sweep_overdue_tasks() still exists and can be invoked manually, or scheduled once pg_cron is available)';
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('sweep-overdue-tasks', '*/15 * * * *', 'select sweep_overdue_tasks()');
  end if;
end $$;
