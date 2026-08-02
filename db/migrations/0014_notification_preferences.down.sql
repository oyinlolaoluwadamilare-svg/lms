do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('sweep-overdue-tasks');
  end if;
exception when others then
  raise notice 'could not unschedule sweep-overdue-tasks (pg_cron unavailable or job already absent) - continuing';
end $$;

drop function if exists sweep_overdue_tasks();
drop index if exists notifications_task_overdue_once;

drop policy if exists notification_preferences_update on notification_preferences;
drop policy if exists notification_preferences_upsert on notification_preferences;
drop policy if exists notification_preferences_select on notification_preferences;
drop table if exists notification_preferences;
