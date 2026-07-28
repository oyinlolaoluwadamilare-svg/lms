-- M0.6: audit_entries (db/schema.sql), append-only. current_tenant_id() and has_role() already
-- exist from 0003_rls_foundation - not redefined here.
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

alter table audit_entries enable row level security;

-- Read: tenant_admin, executive and director within their own tenant only
-- (docs/02-permission-matrix.md: admin.view_audit_log). Deliberately no insert/update/delete
-- policy at all - the application-level `authenticated` role can never write or mutate a row here;
-- only the service_role (which bypasses RLS entirely) ever inserts one, via the single path in
-- src/services/audit.ts's writeAudit(). bde and team_lead get no policy match at all, so they see
-- zero rows - not an error, the same "denied" shape as every other RLS-filtered read.
create policy audit_select on audit_entries for select using (
  tenant_id = current_tenant_id()
  and (has_role('tenant_admin') or has_role('executive') or has_role('director'))
);

-- Guard: block any attempt to mutate immutable history, for every role including the table owner
-- and service_role - RLS alone does not stop those two, since RLS only restricts roles other than
-- the table owner and never applies to a role with the bypassrls attribute (service_role has it).
-- CLAUDE.md #4 ("append-only... corrections are revisions or retractions that preserve the
-- original") and #6 ("every state change writes an audit row, no exceptions") both depend on this
-- being a real, structural guarantee rather than a convention any writer could bypass by mistake.
create or replace function forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'Table % is append-only and cannot be modified', tg_table_name;
end $$;

create trigger trg_no_update_audit before update or delete on audit_entries
  for each statement execute function forbid_mutation();
