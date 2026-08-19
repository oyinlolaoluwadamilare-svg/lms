-- M5.7 (docs/07-build-backlog.md): "Activity attribution to contacts; contact-level last-engaged."
-- docs/01-domain-model.md's own field list for this table is deliberately minimal: `activity_id,
-- contact_id - attribution to one or more stakeholders; updates contact last_engaged_at`. Unlike
-- `deal_contacts` (migration 0018), the domain model names no `decision_role`/`is_primary`-shaped
-- fields here at all - a plain many-to-many join, not a richer relationship, so this migration
-- follows that narrower shape deliberately rather than copying `deal_contacts`' fuller one out of
-- habit. Migration 0008's own header comment named this exact table and named this exact milestone
-- as the reason it was deferred ("activity_contacts is deferred to M5.7 ... which is explicitly the
-- same deliverable under a different name") - not invented now, simply built once its dependency
-- (`contacts`, M5.5) is real.
--
-- **Table shape and cardinality, not left to inference**: docs/06-ui-spec.md's Log Activity modal
-- field list says "contacts present" (plural) - a single nullable `contact_id` on `activities`
-- (the shape `documents` uses for its own many-to-one relationship to a deal/activity/contact)
-- cannot express more than one attendee per engagement, so this is a join table, mirroring
-- `deal_contacts`' own many-to-many shape, not `documents.activity_id`'s many-to-one one.
--
-- **Insert-only, no update/delete policy** - the same reasoning migration 0018 gave for
-- `deal_contacts` ("no doc or backlog line names a 'revise a recorded outcome' action") applies
-- doubly here: activities themselves are append-only (CLAUDE.md #4), so a join table recording who
-- was present at one can never legitimately need editing either - if a contact list needs correcting
-- for a genuinely wrong past entry, the actor logs a fresh activity to correct it, the same
-- correction-preserves-the-original discipline the append-only ledger convention already gives
-- every other engagement-history table in this schema.
--
-- **A linked contact must already be a stakeholder on the activity's own deal** - not stated
-- outright anywhere, but the same class of obvious-but-unstated structural requirement migration
-- 0018's own header comment already treats "contact must belong to the deal's account" as (not a
-- business-rule ambiguity worth escalating): "stakeholders" in docs/06-ui-spec.md's Stakeholders
-- section are precisely the contacts a deal has already linked via `deal_contacts` - attributing an
-- activity to someone who was never even linked to the deal as a stakeholder would let the
-- Stakeholders section and the engagement timeline disagree about who's actually involved, which no
-- reading of either section supports. Enforced below by `validate_activity_contact()`, the same
-- non-bypassable-DB-backstop-behind-a-friendlier-TS-check split every compound write since M5.2 uses
-- (src/services/activities.ts's own logActivity does the friendly pre-check).
--
-- **No `activity.attribute_contact` permission action** - docs/02-permission-matrix.md names no
-- such action, the same "not invented here" gap migration 0018 already flagged for `contact.
-- unlink_from_deal`. Attribution rides along with `activity.create`'s own existing scope check
-- (the actor creating the activity is the same actor choosing who was present at it) - RLS below
-- mirrors `activities_insert`'s exact own/practice/practice/denied/tenant shape through the
-- activity's own `deal_id`, the same way migration 0010's `documents_insert` already mirrors it for
-- `activity.attach_file`.
create table activity_contacts (
  activity_id uuid not null references activities(id),
  contact_id uuid not null references contacts(id),
  primary key (activity_id, contact_id)
);
create index activity_contacts_contact on activity_contacts (contact_id);

-- security definer, not the plain invoker-rights shape most before-insert triggers in this schema
-- use: this function's own internal reads (the activity's deal_id, whether that deal already links
-- this contact) must reflect ground truth regardless of the calling actor's own RLS visibility -
-- the identical reasoning migration 0018's own `validate_deal_contact()` comment gives, and the
-- identical bug class that comment's own "real bug" paragraph found and fixed there: a plain
-- version would let a caller outside the activity's deal's practice see a false "not linked"
-- (since deal_contacts_select already hides every row from them) and trip this exception instead of
-- the RLS-permission rejection that should have stopped them first.
create or replace function validate_activity_contact() returns trigger
language plpgsql security definer as $$
declare
  v_deal_id uuid;
  v_linked boolean;
begin
  select deal_id into v_deal_id from activities where id = new.activity_id;

  select exists(
    select 1 from deal_contacts where deal_id = v_deal_id and contact_id = new.contact_id
  ) into v_linked;

  if not v_linked then
    raise exception 'contact % is not linked to the deal activity % belongs to - link it via deal_contacts first',
      new.contact_id, new.activity_id;
  end if;

  return new;
end;
$$;

create trigger trg_validate_activity_contact
  before insert on activity_contacts
  for each row execute function validate_activity_contact();

-- The contact-level analogue of migration 0009's `refresh_deal_engagement()`: same filter shape
-- (max `activity_date` where `is_client_facing` and not retracted), scoped through
-- `activity_contacts` instead of `activities.deal_id` directly - docs/01-domain-model.md's own
-- derived-values table: "contacts.last_engaged_at | max attributed client-facing activity date."
-- A single-contact full recompute, called by both trigger wrappers below, deliberately NOT written
-- as one GROUP-BY query across every affected contact at once: a plain aggregate keyed to one fixed
-- id always returns exactly one row (correctly resetting to null when there is nothing left to
-- aggregate, the same property that makes 0009's own coalesce(new.deal_id, old.deal_id) approach
-- correct), whereas a GROUP BY silently omits a contact from its result entirely the moment their
-- last qualifying activity is retracted - it would leave last_engaged_at stale instead of resetting
-- it, the exact kind of stale derived field CLAUDE.md #7 says is worse than no indicator at all.
create or replace function refresh_contact_engagement(p_contact_id uuid) returns void
language plpgsql security definer as $$
begin
  update contacts c set
    last_engaged_at = sub.max_date,
    updated_at = now()
  from (
    select max(a.activity_date) as max_date
    from activity_contacts ac
    join activities a on a.id = ac.activity_id
    where ac.contact_id = p_contact_id and a.is_client_facing and a.retracted_at is null
  ) sub
  where c.id = p_contact_id;
end;
$$;

-- Fires once per newly-attributed contact at attribution time (there is no activity_contacts row
-- yet at the moment an activity is first INSERTed - contacts are attributed in a second statement
-- right after, the same disclosed non-atomicity every compound write in this Supabase-client
-- architecture already accepts - so this is the only trigger that needs to run ON INSERT here).
create or replace function trg_fn_activity_contact_refresh() returns trigger
language plpgsql security definer as $$
begin
  perform refresh_contact_engagement(new.contact_id);
  return new;
end;
$$;

create trigger trg_activity_contact_refresh
  after insert on activity_contacts
  for each row execute function trg_fn_activity_contact_refresh();

-- Fires when the underlying activity is later edited or retracted (migration 0008's own
-- activities_update policy; M3.6's retraction also writes via UPDATE, not a separate table, the
-- same reasoning 0009's own trg_activity_refresh comment gives for firing on UPDATE too) - without
-- this, retracting an activity that had already been attributed to a contact would leave that
-- contact's last_engaged_at reflecting an engagement CLAUDE.md #4's retraction discipline says
-- should no longer count, the identical staleness 0009's deal-level trigger already prevents at the
-- deal level. Recomputes every contact currently attributed to this activity, not just the ones
-- whose date changed - the same cheap "recompute from scratch rather than diff" discipline 0009
-- already uses, and for the same reason: correctness here is worth more than the trivial extra cost.
create or replace function trg_fn_activity_update_refresh_contacts() returns trigger
language plpgsql security definer as $$
declare
  v_contact_id uuid;
begin
  for v_contact_id in select contact_id from activity_contacts where activity_id = new.id loop
    perform refresh_contact_engagement(v_contact_id);
  end loop;
  return new;
end;
$$;

create trigger trg_activity_update_refresh_contacts
  after update on activities
  for each row execute function trg_fn_activity_update_refresh_contacts();

alter table activity_contacts enable row level security;

-- "Inherits activity visibility" (the same name M3.8's own documents_select comment uses for its
-- identical shape) - mirrors activities_select/activity_revisions_select exactly, via the same
-- one-hop-through-activities join activity_revisions_select already established for a table with
-- no tenant_id/deal_id column of its own.
create policy activity_contacts_select on activity_contacts for select using (
  exists (
    select 1 from activities a
    where a.id = activity_id and a.tenant_id = current_tenant_id() and (
      has_role('tenant_admin') or has_role('executive')
      or (a.deal_id is not null and deal_practice_line_id(a.deal_id) in (select entitled_practices()))
    )
  )
);

-- Mirrors activities_insert/documents_insert exactly (own/practice/practice/denied/tenant, through
-- the activity's own deal_id) - see this migration's own header comment for why attribution rides
-- along with activity.create's scope rather than a separate permission action.
create policy activity_contacts_insert on activity_contacts for insert with check (
  exists (
    select 1 from activities a
    where a.id = activity_id and a.tenant_id = current_tenant_id() and a.deal_id is not null and can_write() and (
      has_role('tenant_admin')
      or ((has_role('director') or has_role('team_lead')) and deal_practice_line_id(a.deal_id) in (select entitled_practices()))
      or (has_role('bde') and (
            deal_owner_id(a.deal_id) = auth.uid() or deal_author_id(a.deal_id) = auth.uid()
            or is_deal_co_owner(a.deal_id)
         ))
    )
  )
);
-- No update/delete policy - see this migration's own header comment.
