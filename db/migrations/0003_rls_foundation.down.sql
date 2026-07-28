drop policy if exists user_roles_update on user_roles;
drop policy if exists user_roles_insert on user_roles;
drop policy if exists user_roles_select on user_roles;

drop policy if exists users_update on users;
drop policy if exists users_insert on users;
drop policy if exists users_select on users;

drop policy if exists practice_lines_update on practice_lines;
drop policy if exists practice_lines_insert on practice_lines;
drop policy if exists practice_lines_select on practice_lines;

drop policy if exists tenants_select on tenants;

alter table user_roles     disable row level security;
alter table users          disable row level security;
alter table practice_lines disable row level security;
alter table tenants        disable row level security;

drop function if exists can_write();
drop function if exists entitled_practices();
drop function if exists has_role(app_role);
drop function if exists current_tenant_id();
