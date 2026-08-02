drop trigger if exists trg_no_update_stage_events on stage_events;
drop policy if exists stage_events_select on stage_events;
drop trigger if exists trg_stage_events_before_insert on stage_events;
drop function if exists stage_events_before_insert();
drop table if exists stage_events;
