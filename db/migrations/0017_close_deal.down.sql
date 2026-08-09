-- Reverses 0017_close_deal.up.sql.

drop function if exists close_deal(uuid, outcome_type, uuid, text, text, bigint, char(3), date);
alter table outcome_reasons drop constraint if exists requires_competitor_name_only_for_loss;
alter table outcome_reasons drop column if exists requires_competitor_name;
