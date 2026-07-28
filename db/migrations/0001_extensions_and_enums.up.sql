-- M0.2: extensions and enums needed by the tenancy/RLS foundation only.
-- Other enums (stage_type, activity_type, etc.) arrive with the milestone that needs them.
create extension if not exists "uuid-ossp";
create extension if not exists "citext";        -- case-insensitive email

create type user_status as enum ('active','pending','suspended','inactive');
create type app_role    as enum ('tenant_admin','executive','director','team_lead','bde');
