-- Reverses 0021_user_roles_manager.up.sql.

drop index if exists user_roles_manager;
drop trigger if exists trg_validate_user_roles_manager on user_roles;
drop function if exists validate_user_roles_manager();
alter table user_roles drop column if exists manager_id;
