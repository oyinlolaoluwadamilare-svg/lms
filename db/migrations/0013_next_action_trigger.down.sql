drop trigger if exists trg_task_refresh on tasks;
drop function if exists refresh_deal_next_action();
alter table deals drop constraint if exists deals_next_action_task_id_fkey;
