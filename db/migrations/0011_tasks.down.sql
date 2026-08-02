drop policy if exists task_watchers_select on task_watchers;
drop policy if exists task_comments_insert on task_comments;
drop policy if exists task_comments_select on task_comments;
drop trigger if exists trg_no_update_task_assignments on task_assignments;
drop policy if exists task_assignments_select on task_assignments;
drop policy if exists tasks_update on tasks;
drop policy if exists tasks_insert on tasks;
drop policy if exists tasks_select on tasks;

drop function if exists task_assigned_by(uuid);
drop function if exists task_assignee_id(uuid);
drop function if exists task_deal_id(uuid);
drop function if exists task_tenant_id(uuid);

drop trigger if exists tasks_set_updated_at on tasks;

drop table if exists task_watchers;
drop table if exists task_comments;
drop table if exists task_assignments;
drop table if exists tasks;

drop type if exists task_priority;
drop type if exists task_status;
