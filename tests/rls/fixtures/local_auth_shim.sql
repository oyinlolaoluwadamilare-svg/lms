-- LOCAL/CI TEST FIXTURE ONLY. Never apply this to a real Supabase database - Supabase already
-- provides a real `auth` schema and `auth.uid()`. This shim exists so db/schema.sql's policies
-- and helper functions (which call auth.uid() exactly as they would on Supabase) can be exercised
-- against a plain local Postgres instance.
--
-- auth.uid() reads the same GUC PostgREST/Supabase sets per request: request.jwt.claim.sub.
-- Tests "log in" as a given user by running:
--   select set_config('request.jwt.claim.sub', '<user-uuid>', false);
-- on their connection before issuing queries.

create schema if not exists auth;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- M3.8: migration 0010 provisions the real "documents" Storage bucket via `insert into
-- storage.buckets` (Supabase Storage buckets are plain rows in storage.buckets - documented
-- Supabase behaviour). A plain local Postgres has no `storage` schema at all, so this shim
-- provides just enough of it (the one table that one insert touches) for the migration to apply
-- locally - RLS tests never read/write actual file bytes against local Postgres; only the real
-- hosted project's Storage API is ever used for that (src/services/documents.ts).
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);
