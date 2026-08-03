drop policy if exists deal_outcomes_insert on deal_outcomes;
drop policy if exists deal_outcomes_select on deal_outcomes;
drop table if exists deal_outcomes;

drop policy if exists outcome_reasons_update on outcome_reasons;
drop policy if exists outcome_reasons_insert on outcome_reasons;
drop policy if exists outcome_reasons_select on outcome_reasons;
drop trigger if exists outcome_reasons_set_updated_at on outcome_reasons;
drop table if exists outcome_reasons;

drop type if exists outcome_type;
