-- Reverses 0018_contacts_and_deal_contacts.up.sql.

drop policy if exists deal_contacts_insert on deal_contacts;
drop policy if exists deal_contacts_select on deal_contacts;
drop policy if exists contacts_update on contacts;
drop policy if exists contacts_insert on contacts;
drop policy if exists contacts_select on contacts;

drop trigger if exists trg_validate_deal_contact on deal_contacts;
drop function if exists validate_deal_contact();

drop trigger if exists contacts_set_updated_at on contacts;

drop table if exists deal_contacts;
drop table if exists contacts;
drop type if exists decision_role;
