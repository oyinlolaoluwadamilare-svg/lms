-- Reverses 0019_activity_contacts.up.sql.

drop policy if exists activity_contacts_insert on activity_contacts;
drop policy if exists activity_contacts_select on activity_contacts;

drop trigger if exists trg_activity_update_refresh_contacts on activities;
drop function if exists trg_fn_activity_update_refresh_contacts();

drop trigger if exists trg_activity_contact_refresh on activity_contacts;
drop function if exists trg_fn_activity_contact_refresh();

drop function if exists refresh_contact_engagement(uuid);

drop trigger if exists trg_validate_activity_contact on activity_contacts;
drop function if exists validate_activity_contact();

drop table if exists activity_contacts;
