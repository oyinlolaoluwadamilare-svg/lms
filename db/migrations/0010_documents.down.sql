drop policy if exists documents_insert on documents;
drop policy if exists documents_select on documents;
drop trigger if exists trg_documents_before_insert on documents;
drop function if exists documents_before_insert();
drop table if exists documents;
drop type if exists document_type;
-- Deliberately does NOT delete the storage.buckets row: verified directly against the real hosted
-- project that Supabase blocks a direct SQL DELETE against storage tables ("Direct deletion from
-- storage tables is not allowed. Use the Storage API instead" - storage.protect_delete()), a
-- protection the local shim (tests/rls/fixtures/local_auth_shim.sql) doesn't reproduce. Rolling
-- back this migration leaves the empty, unused private "documents" bucket in place - harmless - and
-- a real teardown would go through the Storage API or dashboard, not raw SQL, if ever needed.
