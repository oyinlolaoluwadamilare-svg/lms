-- M5.5 (docs/07-build-backlog.md): "`contacts`, `deal_contacts` migrations; primary-contact
-- invariant." docs/01-domain-model.md: contacts = "id, tenant_id, account_id, first_name,
-- last_name, job_title, email, phone, linkedin_url, is_active, last_engaged_at (derived), is_demo";
-- deal_contacts = "deal_id, contact_id, decision_role (...), is_primary, added_at, added_by",
-- Invariant: "exactly one is_primary = true per deal when any contact exists."
--
-- db/schema.sql already carries reference definitions for both tables (lines 148-163, 220-229) plus
-- the `decision_role` enum and a partial unique index (`one_primary_contact ... where is_primary`) -
-- the same "reference kit either followed or deliberately deviated from, every deviation named"
-- discipline migrations 0005/0016 already established. Deviations from schema.sql, each justified:
--
-- 1. `contacts` gains `updated_at`, `updated_by`, `created_by` (schema.sql has only `created_at`) -
--    docs/01-domain-model.md's own opening rule ("every mutable table carries created_at,
--    updated_at, created_by, updated_by") wins, the same fix migration 0005 made for
--    accounts/deals and migration 0016 made for outcome_reasons. Reuses migration 0006's
--    `set_updated_at_and_by()` trigger verbatim, not a new one.
-- 2. Both tables get RLS enabled (schema.sql enables it on neither) - CLAUDE.md #2, the same fix
--    migration 0005 already made for pipeline_stages/accounts/account_practice_owners/
--    deal_co_owners and migration 0016 made for outcome_reasons/deal_outcomes.
-- 3. `deal_contacts` gets SELECT and INSERT policies only, no UPDATE/DELETE - docs/02-permission-
--    matrix.md names `contact.link_to_deal` (insert-shaped) but no `contact.unlink_from_deal`, no
--    `deal.remove_contact`, and no action for revising a linked contact's `decision_role` or
--    reassigning `is_primary`. The exact same reasoning migration 0016 gave for `deal_outcomes`
--    ("no doc or backlog line names a 'revise a recorded outcome' action") applies here - not
--    invented, left for whichever future milestone actually names that action (M5.6, "contact
--    management on the deal," is the obvious candidate, not this one).
-- 4. No dedupe/uniqueness constraint added to `contacts` (schema.sql already has none, unlike
--    accounts' `normalised_name` fuzzy-match unique index) - nothing in the backlog through M5.7
--    asks for contact deduplication; "not invented here," the same discipline migration 0016 used
--    for not inventing a code column on outcome_reasons.
--
-- The primary-contact invariant, precisely: schema.sql's `one_primary_contact` partial unique index
-- enforces only "at most one primary per deal" - it does not by itself enforce "exactly one *when
-- any contact exists*" (a deal could legally have contacts and zero primaries under the index
-- alone). Since `deal_contacts` is insert-only (point 3 above - no update path exists to promote a
-- later contact to primary), the only moment this half of the invariant can be established or
-- broken is the very first insert for a deal: `validate_deal_contact()` below rejects an attempt to
-- insert a deal's first contact with `is_primary = false`, the same "DB-level non-bypassable
-- backstop behind a friendlier TS-layer default" split `deal_outcomes`' own checks (loss_requires_
-- detail, final_value_needs_currency) already use for M5.2 - src/services/contacts.ts's own
-- linkContactToDeal decides is_primary itself (true for the first contact, false otherwise) so a
-- normal caller never hits this exception, but a caller bypassing the service (or a bug in it)
-- cannot leave a deal with contacts and no primary regardless.
--
-- Same trigger also enforces an invariant docs/01-domain-model.md states explicitly for the
-- structurally identical `deal_co_owners` ("co-owner must belong to the deal's practice line") but
-- never states for `deal_contacts` outright: a linked contact must belong to the SAME account as
-- the deal. Nothing in any doc names this as a "the docs are wrong" situation - it reads as the
-- same class of obvious-but-unstated structural requirement, not a business-rule ambiguity, and
-- leaving it unenforced would let a deal be attributed a stakeholder from a completely unrelated
-- client, which no interpretation of "stakeholder" in docs/06-ui-spec.md's own Stakeholders section
-- supports.

create type decision_role as enum (
  'champion', 'economic_buyer', 'influencer', 'technical_evaluator', 'procurement', 'blocker', 'unknown'
);

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
  last_engaged_at date, -- derived; no write path yet (M5.7: "contact-level last-engaged")
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id),
  deleted_at timestamptz
);
create index contacts_account on contacts (account_id) where deleted_at is null;

create trigger contacts_set_updated_at
  before update on contacts
  for each row execute function set_updated_at_and_by();

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
create index deal_contacts_contact on deal_contacts (contact_id);

-- security definer, not the plain invoker-rights shape stage_events_before_insert()/
-- set_updated_at_and_by() use: this function's own internal reads (the deal's account, the
-- contact's account, the deal's current contact count) must reflect ground truth regardless of the
-- calling actor's own RLS visibility. A plain invoker-rights version would let a caller outside the
-- deal's practice - who deal_contacts_select already hides every existing row from - see a
-- false "zero existing contacts" count and trip the wrong exception (masking what should be a
-- clean RLS-permission rejection with a misleading "first contact must be primary" one); worse, it
-- would silently accept an insert on a deal this trigger can't fully see the state of. Verified
-- directly: caught by tests/rls/contacts.spec.ts's own "bde outside the deal's practice" case
-- before this was fixed.
create or replace function validate_deal_contact() returns trigger
language plpgsql security definer as $$
declare
  v_deal_account_id uuid;
  v_contact_account_id uuid;
  v_existing_count integer;
begin
  select account_id into v_deal_account_id from deals where id = new.deal_id;
  select account_id into v_contact_account_id from contacts where id = new.contact_id;

  if v_deal_account_id is distinct from v_contact_account_id then
    raise exception 'contact % belongs to a different account than deal %', new.contact_id, new.deal_id;
  end if;

  select count(*) into v_existing_count from deal_contacts where deal_id = new.deal_id;
  if v_existing_count = 0 and not new.is_primary then
    raise exception 'the first contact linked to a deal must be marked primary';
  end if;

  return new;
end;
$$;

create trigger trg_validate_deal_contact
  before insert on deal_contacts
  for each row execute function validate_deal_contact();

alter table contacts enable row level security;
alter table deal_contacts enable row level security;

-- Mirrors accounts_select/accounts_update exactly (migration 0005) via the same
-- account_has_entitled_practice() helper - a contact is visible/editable to whoever can already see
-- the account it belongs to. INSERT mirrors accounts_insert's own shape too (tenant + can_write(),
-- no entitlement check at the RLS layer) - the precise "practice" scope from docs/02-permission-
-- matrix.md's contact.create/contact.update rows is the TS service layer's job
-- (src/services/contacts.ts), the same "RLS coarse, service precise" split CLAUDE.md #1 requires
-- and accounts' own insert policy already established as this schema's convention for this exact
-- multi-practice-owner shape (an account can be entitled to more than one practice line via
-- account_practice_owners, which a single practiceLineId-shaped Resource can't express as cleanly
-- as re-deriving it directly).
create policy contacts_select on contacts for select using (
  tenant_id = current_tenant_id() and deleted_at is null and (
    has_role('tenant_admin') or has_role('executive') or account_has_entitled_practice(account_id)
  )
);
create policy contacts_insert on contacts for insert with check (
  tenant_id = current_tenant_id() and can_write()
);
create policy contacts_update on contacts for update using (
  tenant_id = current_tenant_id() and deleted_at is null and (
    has_role('tenant_admin') or account_has_entitled_practice(account_id)
  )
);
-- No delete policy: soft delete only, via update setting deleted_at (CLAUDE.md #3).

-- Mirrors deal_co_owners_select/deal_co_owners_insert exactly (migration 0005) - contact.link_to_deal
-- shares deal.add_co_owner's own own/practice/practice/-/tenant scope in docs/02-permission-
-- matrix.md, so the same policy shape applies verbatim, substituting deal_contacts for
-- deal_co_owners and reusing the same deal_tenant_id/deal_practice_line_id/deal_owner_id/
-- deal_author_id/entitled_practices/has_role/can_write helpers migration 0005 introduced
-- specifically to avoid RLS-policy recursion between deals and its join tables.
create policy deal_contacts_select on deal_contacts for select using (
  deal_tenant_id(deal_id) = current_tenant_id() and (
    has_role('tenant_admin') or has_role('executive')
    or deal_practice_line_id(deal_id) in (select entitled_practices())
  )
);
create policy deal_contacts_insert on deal_contacts for insert with check (
  deal_tenant_id(deal_id) = current_tenant_id() and can_write() and (
    has_role('tenant_admin')
    or (deal_practice_line_id(deal_id) in (select entitled_practices()) and (
          has_role('director') or has_role('team_lead')
          or deal_owner_id(deal_id) = auth.uid() or deal_author_id(deal_id) = auth.uid()
       ))
  )
);
-- No update/delete policy - see this migration's own header comment, point 3.
