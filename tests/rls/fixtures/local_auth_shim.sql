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
