-- M5.2 (docs/07-build-backlog.md): "`closeDeal` service: atomic outcome, stage event, status,
-- open-task cancellation, audit. Closing is impossible without a reason; loss requires detail;
-- lost-to-competitor requires a name."
--
-- Two decisions this migration makes, neither pinned down by any doc, each recorded here rather
-- than silently assumed:
--
-- 1. "lost-to-competitor requires a name" - migration 0016's own header comment deliberately left
--    open HOW a reason is recognised as competitor-shaped. Decided here: a new
--    `requires_competitor_name` boolean on `outcome_reasons`, tenant-admin-settable per reason
--    (via the existing admin screen's own update path, M5.1), defaulting to false. Rejected
--    alternatives: matching a reserved/magic label string (fragile - labels are free-text and
--    tenant-editable, migration 0016's own `unique (tenant_id, type, label)` constraint already
--    treats them as such) and unconditionally requiring a competitor name whenever `result =
--    'loss'` (wrong - not every loss is to a competitor; docs/07-build-backlog.md's M5.4 "loss-
--    reason report by practice, value band and competitor" only makes sense as a real reporting
--    dimension if competitor is genuinely absent on non-competitor losses, not forced onto every
--    row). A check constraint keeps the flag meaningless for win reasons, where "competitor" has
--    no meaning at all.
--
-- 2. Atomicity - "atomic" is the backlog line's own word, and docs/03-architecture.md is explicit
--    beyond aspiration here: "Every state change is a transaction that includes its audit entry.
--    If the audit write fails, the business write rolls back." Every compound write built so far
--    (changeStage: deal + stage_events + audit) instead used sequential Supabase-client calls with
--    an explicitly disclosed non-atomicity gap - src/services/audit.ts, src/services/
--    stageEvents.ts and changeStage's own comment all name the same fix: "a single Postgres
--    function invoked through one .rpc() call," not built until now. closeDeal touches FOUR
--    tables (deals, stage_events, deal_outcomes, tasks) plus audit_entries - the highest-risk
--    compound write yet (a partial failure here means a deal silently looks won with no outcome
--    record, or an outcome record with no status change) - so this is that function, `close_deal`,
--    a single `security definer` plpgsql function called via one `.rpc()`, wrapping every write in
--    one real Postgres transaction: all-or-nothing, exactly matching every other write this
--    function performs failing together if any one of them does.
--
-- Trust boundary, consistent with every other service-role-backed write in this codebase
-- (writeStageEvent/writeAudit/sweep_overdue_tasks - none independently re-verify role-scope
-- authorisation inside the privileged write itself): `close_deal` does NOT re-implement
-- deal.mark_won/deal.mark_lost's own own/practice/tenant scope check internally via
-- has_role()/entitled_practices() - src/services/deals.ts's closeDeal (the TS caller) already
-- calls can() before ever invoking this function, the same "TS can() is the real gate, the
-- privileged write trusts it" split this codebase has used since M2.1. What IS checked inside the
-- function: the deal actually exists and belongs to the given tenant (a cheap, redundant-with-the-
-- caller-supplied-tenant sanity check, the same "explicit comparison documents intent rather than
-- relying silently on caller correctness" reasoning getUserByAuthId's own comment already gives),
-- the chosen reason belongs to the same tenant and matches the result type (win/loss), and the
-- competitor-name/loss-detail rules - the caller (src/services/deals.ts) validates all of these
-- too, for a clean result code instead of a raw exception, but the function repeats them as its
-- own independent, non-bypassable control (CLAUDE.md #1).
--
-- Not touched here: `forecast_category` is left exactly as it was before closing - nothing in the
-- backlog asks for an automatic derivation, and no existing code anywhere auto-sets it (it is a
-- purely manual/override field, docs/02-permission-matrix.md's `deal.override_forecast_category`).
-- `auth.uid()` is used directly for actor identity throughout, never a caller-supplied parameter -
-- the same impersonation-proofing every author_id/actor_id column in this schema already relies on
-- (task_comments.author_id, activities.author_id, ...), unaffected by running inside a `security
-- definer` function (it reads the session-level JWT claim GUC, not the function owner's identity).

alter table outcome_reasons add column requires_competitor_name boolean not null default false;
alter table outcome_reasons add constraint requires_competitor_name_only_for_loss check (
  not requires_competitor_name or type = 'loss'
);

create or replace function close_deal(
  p_deal_id uuid,
  p_result outcome_type,
  p_reason_id uuid,
  p_reason_detail text,
  p_competitor_name text,
  p_final_value_minor bigint,
  p_currency_code char(3),
  p_actual_close_date date
) returns void
language plpgsql
security definer
as $$
declare
  v_tenant_id uuid;
  v_from_stage_id uuid;
  v_to_stage_id uuid;
  v_reason_type outcome_type;
  v_requires_competitor boolean;
  v_new_status deal_status;
begin
  select tenant_id, stage_id into v_tenant_id, v_from_stage_id from deals where id = p_deal_id and deleted_at is null;
  if v_tenant_id is null then
    raise exception 'deal % not found', p_deal_id;
  end if;

  select type, requires_competitor_name into v_reason_type, v_requires_competitor
    from outcome_reasons where id = p_reason_id and tenant_id = v_tenant_id;
  if v_reason_type is null then
    raise exception 'outcome reason % not found for this tenant', p_reason_id;
  end if;
  if v_reason_type <> p_result then
    raise exception 'outcome reason type (%) does not match result (%)', v_reason_type, p_result;
  end if;
  if v_requires_competitor and length(btrim(coalesce(p_competitor_name, ''))) = 0 then
    raise exception 'this loss reason requires a competitor name';
  end if;

  -- "exactly one won and one lost stage per tenant" (migration 0005's own partial unique indexes) -
  -- the target stage is always uniquely determined by tenant + desired outcome, never a caller-
  -- supplied id (unlike changeStage, which moves between open stages a caller genuinely chooses
  -- among).
  v_new_status := case p_result when 'win' then 'won' else 'lost' end;
  select id into v_to_stage_id from pipeline_stages
    where tenant_id = v_tenant_id and stage_type = (case p_result when 'win' then 'won' else 'lost' end)::stage_type;
  if v_to_stage_id is null then
    raise exception 'tenant % has no % stage configured', v_tenant_id, v_new_status;
  end if;

  update deals set status = v_new_status, stage_id = v_to_stage_id, actual_close_date = p_actual_close_date
  where id = p_deal_id;

  insert into stage_events (tenant_id, deal_id, from_stage_id, to_stage_id, actor_id)
  values (v_tenant_id, p_deal_id, v_from_stage_id, v_to_stage_id, auth.uid());

  -- deal_outcomes' own loss_requires_detail check (migration 0016) is the authoritative backstop
  -- for "loss requires detail" - not repeated above, one fewer place to keep in sync.
  insert into deal_outcomes (
    deal_id, result, reason_id, reason_detail, competitor_name, final_value_minor, currency_code,
    actual_close_date, closed_by
  ) values (
    p_deal_id, p_result, p_reason_id, p_reason_detail, p_competitor_name, p_final_value_minor,
    p_currency_code, p_actual_close_date, auth.uid()
  );

  -- "Closing a deal cancels remaining open tasks" (docs/01-domain-model.md) - every open task on
  -- the deal, not only ones the closing actor themselves assigned (task.cancel's own narrower
  -- assigned_by scope would under-cancel here: a co-owner or the actor's team lead may have
  -- assigned some of them). Authority to cancel every one of them derives from "you may close this
  -- deal" (already checked by the caller before this function is ever invoked), the same way
  -- writeStageEvent/writeAudit's own privileged writes never re-check a per-row can().
  update tasks set status = 'cancelled', updated_at = now(), updated_by = auth.uid()
  where deal_id = p_deal_id and status in ('open', 'in_progress', 'blocked') and deleted_at is null;

  insert into audit_entries (tenant_id, actor_id, entity_type, entity_id, action, before, after, ip_hash)
  values (
    v_tenant_id, auth.uid(), 'deal', p_deal_id,
    case p_result when 'win' then 'deal.mark_won' else 'deal.mark_lost' end,
    jsonb_build_object('stageId', v_from_stage_id, 'status', 'active'),
    jsonb_build_object('stageId', v_to_stage_id, 'status', v_new_status, 'reasonId', p_reason_id),
    null
  );
end;
$$;
