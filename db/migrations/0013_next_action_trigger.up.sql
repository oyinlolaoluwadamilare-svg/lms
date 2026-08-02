-- M4.4 (docs/07-build-backlog.md): "`next_action_task_id` derivation trigger; the next-action strip
-- and the 'No next step' state on the deal header." The trigger itself was deliberately deferred
-- from migration 0011 (tasks) - that migration's own header comment named this exact split, the
-- identical M3.1/M3.2 structure-then-cross-table-trigger pattern this codebase already established
-- for the engagement trigger (migration 0008 built activities only; migration 0009, a separate
-- milestone, built refresh_deal_engagement()).
--
-- deals.next_action_task_id has existed since migration 0005, with no foreign key - tasks didn't
-- exist yet, the same "a column can't reference a table that isn't there" deferral this codebase's
-- own README already documents for activity_contacts/documents.contact_id/tasks.contact_id. Tasks
-- exists now (migration 0011), so the FK is added here, closing that gap the same way this session
-- always closes a deferred-dependency gap once its dependency actually exists.
alter table deals
  add constraint deals_next_action_task_id_fkey foreign key (next_action_task_id) references tasks(id);

-- A genuine bug in db/schema.sql's own reference implementation, found by reasoning through it
-- rather than reproducing it verbatim (the same scrutiny every earlier migration in this repo has
-- given that file): its refresh_deal_next_action() does
--   update deals d set next_action_task_id = sub.id, ... from (select ... limit 1) sub
--   where d.id = coalesce(new.deal_id, old.deal_id);
-- An `UPDATE ... FROM (subquery)` only updates rows where the FROM subquery contributes at least
-- one row - it is an implicit join, not a LEFT JOIN. When a deal's LAST open task is completed,
-- cancelled or soft-deleted, that subquery (which selects only status in
-- ('open','in_progress','blocked')) returns ZERO rows, so the UPDATE above touches ZERO rows -
-- next_action_task_id/next_action_due_date would be left pointing at the now-closed task forever,
-- never clearing back to null. docs/06-ui-spec.md's own "No next step - add one" empty state
-- depends on this genuinely becoming null, not just usually being null - this is exactly the class
-- of derived-field staleness CLAUDE.md #7 calls "worse than no indicator at all". Fixed below with
-- an explicit `if not found` branch that clears both fields when no open task remains, rather than
-- silently reproducing the reference implementation's gap.
--
-- A deal-less task (deal_id null, migration 0011) is also handled explicitly: coalesce(new.deal_id,
-- old.deal_id) is null in that case, and there is no deal to update - an early return skips the
-- write entirely rather than running a `where d.id = null` clause that would match nothing anyway
-- (harmless either way, but explicit is clearer than relying on that SQL null-comparison quirk).
--
-- Deliberately does NOT set updated_by, matching refresh_deal_engagement()'s own identical choice
-- (migration 0009) - a derived-field recompute triggered by another table's write is not a human
-- edit attributable to a specific actor in the way updated_by's other callers are.
create or replace function refresh_deal_next_action() returns trigger
language plpgsql security definer as $$
declare
  v_deal_id uuid := coalesce(new.deal_id, old.deal_id);
begin
  if v_deal_id is null then
    return null;
  end if;

  update deals d set
    next_action_task_id = sub.id,
    next_action_due_date = sub.due_date,
    updated_at = now()
  from (
    select t.id, t.due_date
    from tasks t
    where t.deal_id = v_deal_id and t.status in ('open', 'in_progress', 'blocked') and t.deleted_at is null
    order by t.due_date asc
    limit 1
  ) sub
  where d.id = v_deal_id;

  if not found then
    update deals set next_action_task_id = null, next_action_due_date = null, updated_at = now()
    where id = v_deal_id;
  end if;

  return null;
end $$;

-- AFTER INSERT OR UPDATE OR DELETE, matching db/schema.sql's own choice (unlike the engagement
-- trigger, which only needs INSERT OR UPDATE since activities are never hard-deleted): tasks has no
-- DELETE policy for `authenticated` either (CLAUDE.md #3 - soft delete only, an UPDATE), but this
-- covers a service-role/migrator-level hard delete too, defensively, at no extra cost.
create trigger trg_task_refresh
  after insert or update or delete on tasks
  for each row execute function refresh_deal_next_action();
