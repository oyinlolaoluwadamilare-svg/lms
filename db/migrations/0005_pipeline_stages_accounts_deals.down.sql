drop policy if exists deal_co_owners_insert on deal_co_owners;
drop policy if exists deal_co_owners_select on deal_co_owners;
drop policy if exists deals_update on deals;
drop policy if exists deals_insert on deals;
drop policy if exists deals_select on deals;
drop policy if exists account_practice_owners_update on account_practice_owners;
drop policy if exists account_practice_owners_insert on account_practice_owners;
drop policy if exists account_practice_owners_select on account_practice_owners;
drop policy if exists accounts_update on accounts;
drop policy if exists accounts_insert on accounts;
drop policy if exists accounts_select on accounts;
drop policy if exists pipeline_stages_update on pipeline_stages;
drop policy if exists pipeline_stages_insert on pipeline_stages;
drop policy if exists pipeline_stages_select on pipeline_stages;

alter table deal_co_owners           disable row level security;
alter table deals                    disable row level security;
alter table account_practice_owners  disable row level security;
alter table accounts                 disable row level security;
alter table pipeline_stages          disable row level security;

drop table if exists deal_co_owners;
drop table if exists deals;
drop table if exists account_practice_owners;
drop table if exists accounts;
drop table if exists pipeline_stages;

drop function if exists account_has_entitled_practice(uuid);
drop function if exists account_tenant_id(uuid);
drop function if exists deal_author_id(uuid);
drop function if exists deal_owner_id(uuid);
drop function if exists deal_practice_line_id(uuid);
drop function if exists deal_tenant_id(uuid);
drop function if exists is_deal_co_owner(uuid);

drop type if exists forecast_category;
drop type if exists client_type;
drop type if exists deal_status;
drop type if exists stage_type;
