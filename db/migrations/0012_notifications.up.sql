-- M4.2 (docs/07-build-backlog.md): "`assignTask` as the single assignment path, writing the ledger
-- entry and notification." The ledger entry is task_assignments (migration 0011, already exists);
-- the notification has no table anywhere yet. docs/01-domain-model.md defines the shape
-- (`notifications`) but - unlike tasks, which db/schema.sql already had a near-complete reference
-- implementation for - there is no schema.sql excerpt for this table at all, so this migration is
-- authored directly from the domain model doc and this codebase's own established patterns, not a
-- "found gaps in the reference kit" exercise like migration 0011 was.
--
-- event_type/entity_type are plain `text`, not enums - matching audit_entries' own identical choice
-- (db/schema.sql: both `text not null`) rather than db/schema.sql's own closed enums used elsewhere
-- (activity_type, task_status, ...). The domain model's own wording is the reason: "Event types
-- include human events (task_assigned, task_reassigned, task_overdue, mentioned, comment_added,
-- deal_escalated, deal_reassigned, quota_milestone) alongside system events" - "include" and
-- "alongside" describe an open-ended, growing vocabulary spanning many future milestones (M4.7's
-- overdue events, M4.8's per-type preferences, automation-rule-driven events far later), not a
-- fixed set to close over now the way task_status's five literal values are.
--
-- RLS is deliberately narrower than every other tenant-scoped table in this codebase: recipient_id
-- = auth.uid() only, with NO tenant_admin/executive tenant-wide override. Every other table's RLS
-- in this schema grants has_role('tenant_admin')/has_role('executive') a broader read - but
-- docs/02-permission-matrix.md has no "notification.view" action at all, for any role, and a
-- notification is inherently personal (CLAUDE.md #10's "no personal data" concern applies loosely
-- here too) - inventing tenant-wide visibility over other users' individual notification streams
-- would be a real overreach with nothing in docs/ asking for it, not a defensible extension of an
-- existing documented scope.
--
-- No insert policy for `authenticated` at all - notifications are always a side effect of some
-- OTHER privileged action (M4.2's assignTask, later M4.7/M4.8/automation-rule events), written via
-- a service-role client, the same shape writeAudit/writeStageEvent already use. An UPDATE policy
-- DOES exist, unlike those two - marking one's own notification read is a genuinely different kind
-- of write (self-service, not privileged), and does not touch recipient_id, so it can never hit
-- migration 0010's own discovered "the SELECT policy re-validates the UPDATE's resulting row"
-- conflict (the row still satisfies recipient_id = auth.uid() after the update).

create table notifications (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  recipient_id uuid not null references users(id),
  actor_id uuid references users(id), -- nullable: a system-generated event (e.g. a future task_overdue sweep) has no human actor
  event_type text not null check (length(btrim(event_type)) > 0),
  entity_type text not null check (length(btrim(entity_type)) > 0),
  entity_id uuid,
  title text not null check (length(btrim(title)) > 0),
  body text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_recipient_unread on notifications (recipient_id, created_at desc) where read_at is null;

alter table notifications enable row level security;

create policy notifications_select on notifications for select using (
  tenant_id = current_tenant_id() and recipient_id = auth.uid()
);

create policy notifications_mark_read on notifications for update using (
  tenant_id = current_tenant_id() and recipient_id = auth.uid()
);

-- No insert policy for `authenticated`: service-role only (writeNotification, mirroring writeAudit's
-- shape). No delete policy: CLAUDE.md #3, and no role is ever granted DELETE on any table regardless.
