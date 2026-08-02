-- M3.8 (docs/07-build-backlog.md): "Attachments on activities, inheriting deal visibility."
--
-- Two deliberate deviations from docs/01-domain-model.md's full `documents` field list, called out
-- rather than silently reproduced or silently dropped:
-- 1. `contact_id` references `contacts(id)`, and `contacts` (M5.5) does not exist yet in this
--    codebase - the same "a table cannot reference a table that isn't there" reasoning migration
--    0008's own comment already gives for deferring `activity_contacts` to M5.7. Not created until
--    its dependency is real.
-- 2. `version_number`/`supersedes_document_id` are explicitly `docs/07-build-backlog.md` **M9.5**'s
--    own deliverable ("Documents with versioning and deal linkage") - a materially later milestone,
--    not this one. Building versioning columns nothing in this milestone populates or reads would be
--    the same premature-feature mistake this codebase has deliberately avoided every time before.
--
-- `account_id` IS included (nullable, unused by any code path yet) even though M3.8's own upload
-- path only ever sets `deal_id`/`activity_id` - mirroring activities.account_id's own precedent
-- (migration 0008: a column that exists per the domain model, with no code path using it yet, is
-- kept rather than omitted, since accounts already exists as a real table to reference. Unlike
-- `contact_id` above, there is no blocking dependency here, only an unbuilt future upload path
-- (Account 360's Documents tab, M5.8) - not the same class of gap as a missing FK target.
--
-- `practice_line_id` IS a physical, denormalised column here (unlike `activities`, which derives
-- practice_line_id from deals via deal_practice_line_id() and stores no such column at all) - this
-- one genuine difference in the domain model's own field lists (docs/01-domain-model.md's activities
-- row omits practice_line_id; its documents row includes it) most plausibly exists because a future
-- document (e.g. an M9.5 template) may be practice-scoped with no deal/account/activity at all.
-- Captured on insert from deal_id by a before-insert trigger, the exact same
-- trigger-is-authoritative pattern stage_id_at_time (migration 0008) already established - never
-- caller-supplied, so it can't drift from the deal it was actually uploaded against.
--
-- File storage: Supabase Storage buckets are plain rows in storage.buckets (documented Supabase
-- behaviour), so provisioning the bucket lives in this migration alongside the schema it supports,
-- consistent with CLAUDE.md's stack table ("migrations in version control"). The bucket is PRIVATE
-- (no anonymous or direct-client access) and no RLS policy is added on storage.objects at all -
-- deliberately, not an oversight: every read/write in this codebase's Supabase-client architecture
-- either goes through the caller's own RLS-scoped session (the real authorisation boundary) or
-- through a service-role client for a privileged single-path write (writeAudit, writeStageEvent,
-- retractActivityRow). File bytes follow the exact same shape - src/services/documents.ts's upload
-- and download paths both check the `documents` table's own RLS (or, for upload, the same can()
-- check every other write already uses) BEFORE ever touching Storage via a service-role client;
-- Storage itself is never reachable by an end user's own session. Duplicating the identical
-- authorisation logic a second time as storage.objects RLS policies would be two sources of truth
-- for one rule, not a second independent control (unlike CLAUDE.md #1's RLS-plus-can() pairing,
-- which checks the SAME resource by two INDEPENDENT mechanisms - this would be the same mechanism,
-- twice, for a resource (a private blob) with no meaningful identity of its own outside the
-- `documents` row that names it).
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

create type document_type as enum ('brief', 'proposal', 'contract', 'minutes', 'other');

create table documents (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  practice_line_id uuid references practice_lines(id), -- captured on insert from deal_id; see above
  deal_id uuid references deals(id),
  account_id uuid references accounts(id), -- unused by any code path yet; see header comment
  activity_id uuid references activities(id),
  file_name text not null check (length(btrim(file_name)) > 0),
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  document_type document_type not null default 'other',
  uploaded_by uuid not null references users(id),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  deleted_at timestamptz -- CLAUDE.md #3: soft delete only, never a hard DELETE
);
create index documents_deal on documents (deal_id) where deleted_at is null;
create index documents_activity on documents (activity_id) where deleted_at is null;

-- Authoritative regardless of what a caller passes for practice_line_id - the same
-- trigger-is-authoritative pattern migrations 0006/0007/0008 already established. A null deal_id
-- (an account-only document - no code path creates one yet, but the column stays nullable per the
-- domain model, same reasoning as activities.account_id) simply leaves practice_line_id null.
create or replace function documents_before_insert() returns trigger
language plpgsql as $$
begin
  if new.deal_id is not null then
    select practice_line_id into new.practice_line_id from deals where id = new.deal_id;
  end if;
  return new;
end $$;

create trigger trg_documents_before_insert before insert on documents
  for each row execute function documents_before_insert();

alter table documents enable row level security;

-- "Inheriting deal visibility" (M3.8's own name): read scope mirrors activities_select exactly,
-- via migration 0005's deal_practice_line_id() helper - the same cross-table RLS recursion
-- reasoning migration 0008's own comment gives for reusing it rather than a raw join to deals.
create policy documents_select on documents for select using (
  tenant_id = current_tenant_id() and deleted_at is null and (
    has_role('tenant_admin') or has_role('executive')
    or (deal_id is not null and deal_practice_line_id(deal_id) in (select entitled_practices()))
  )
);

-- activity.attach_file (docs/02-permission-matrix.md): own (bde - the underlying deal's
-- owner/co-owner/author, the SAME "own" definition activity.create already uses, not the specific
-- activity's own author - there is no activity-authorship concept in this permission, only deal
-- ownership), practice (team_lead, director), tenant (tenant_admin), denied (executive). Mirrors
-- activities_insert's exact shape.
create policy documents_insert on documents for insert with check (
  tenant_id = current_tenant_id() and can_write() and deal_id is not null and (
    has_role('tenant_admin')
    or ((has_role('director') or has_role('team_lead')) and deal_practice_line_id(deal_id) in (select entitled_practices()))
    or (has_role('bde') and (
          deal_owner_id(deal_id) = auth.uid() or deal_author_id(deal_id) = auth.uid()
          or is_deal_co_owner(deal_id)
       ))
  )
);

-- document.soft_delete (docs/02-permission-matrix.md's uploader/practice/practice/denied/tenant
-- scope) is deliberately NOT built as an RLS UPDATE policy here, and not built at all in M3.8 -
-- two separate reasons, not one:
-- 1. Scope: M3.8's own backlog line is "attachments on activities, inheriting deal visibility" -
--    upload plus view. Removing an attachment is a real, separate capability nothing here asks
--    for yet, the same "don't build a control with nothing real behind it" reasoning this codebase
--    applies to every narrower-than-spec vertical slice.
-- 2. A genuine RLS mechanics discovery, worth recording so a future soft-delete implementation
--    doesn't rediscover it the hard way: Postgres re-validates an UPDATE's resulting row against a
--    table's SELECT policy too (verified directly - not merely reasoned about), not only the
--    UPDATE policy's own USING/WITH CHECK. Since documents_select requires `deleted_at is null`,
--    a caller's own RLS-scoped session can NEVER successfully set deleted_at through a plain
--    UPDATE policy - the very act of setting it makes the resulting row fail the SELECT policy
--    that gates the update. This is the identical shape M3.6's retractActivity already hit for a
--    different reason (activities_update is author-only, too narrow for retraction's broader
--    scope) and solved the same way: a future document.soft_delete needs a service-role-backed
--    write, authorised by an explicit can() check beforehand, not an extension of RLS - not
--    `activities_update`-style at all, `retractActivityRow`-style.
--
-- `deleted_at` stays as a column (nullable, unused by any code path yet) for exactly this future
-- capability - the same "documented shape exists, no code path uses it yet" precedent
-- activities.account_id already established, not omitted the way a genuinely blocked FK (this
-- migration's own deferred contact_id) would be.
--
-- No hard-delete policy either: CLAUDE.md #3, never a hard DELETE, no exceptions - and no role is
-- ever granted DELETE privilege on any table at all (scripts/db-grants-local.sh's own comment; the
-- real hosted project's default PostgREST grants are the same shape), so this holds regardless of
-- RLS for every table in this schema, not something documents needs its own trigger for.
