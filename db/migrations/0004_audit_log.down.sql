drop trigger if exists trg_no_update_audit on audit_entries;
drop function if exists forbid_mutation();
drop policy if exists audit_select on audit_entries;
alter table audit_entries disable row level security;
drop table if exists audit_entries;
