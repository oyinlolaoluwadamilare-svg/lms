# Integration tests

Covers repositories, triggers and derived-field maintenance (docs/05-test-strategy.md), starting
with `src/data/deals.ts` in M1.2.

**Runs against the real hosted Supabase project, not a local Postgres.** `src/data` repositories
are built on the Supabase JS client (PostgREST), not a raw Postgres connection - unlike
`tests/rls`, which only needs bare Postgres plus a local auth shim, these need a real PostgREST
layer. This container has no Docker daemon, so a local `supabase start` stack isn't available
either. Each spec file creates and tears down its own dedicated tenant (a fixed, recognisable slug
so a failed run's leftovers are easy to spot and clean up by hand) - never touches `db/seed`'s demo
tenants.

## Running locally

```
npm run test:integration
```

Requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` (the same ones
everything else in this repo already uses).

## Running in CI

The `integration` job in `.github/workflows/ci.yml` needs two repository secrets configured
(Settings -> Secrets and variables -> Actions): `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`,
pointing at the project this suite is allowed to write test rows to and delete them from. **This
job fails until those secrets exist** - that's an intentional, visible signal rather than a job
that silently skips itself.

## Why not the real project used for local dev/demo data

It is the same project (there is only one non-local Supabase project in this repo's history so
far). That's acceptable because every spec's setup/teardown is scoped to its own tenant by a fixed
slug, distinct from `db/seed`'s `acme-demo`/`globex-demo` tenants, and teardown runs in `afterAll`
even on assertion failure paths that don't throw during cleanup.

## A fixture that exercises `writeAudit` can never fully tear down its tenant/users - write it as a permanent, idempotent fixture, not delete-and-recreate

Found running `create-deal-service.spec.ts` twice in a row: the second run failed on
`duplicate key value violates unique constraint "tenants_slug_key"`, even though `afterAll` had
run and reported no errors.

Root cause, confirmed directly against the project (`pg_constraint`): `audit_entries.actor_id` and
`audit_entries.tenant_id` are real foreign keys to `users(id)` and `tenants(id)`. M0.6's
`forbid_mutation()` trigger blocks update/delete on `audit_entries` for every role, including
`service_role` - that is the entire point of that milestone (CLAUDE.md #4, append-only history).
So the moment a test calls `createDeal` (which calls `writeAudit`) even once, the referencing user
and tenant become **permanently un-deletable**. The bulk `DELETE ... WHERE tenant_id = ...` against
`users` doesn't partially succeed either - it's one statement, so one FK-blocked row aborts the
whole statement and every row in that tenant survives, not just the referenced one. The delete
calls don't throw because their `error` is never checked, so this failed silently.

This is correct, intended behaviour for the real app (users are only ever soft-deleted, per
CLAUDE.md #3) - it just means a test fixture cannot assume its tenant/users are torn down.

The fix, and the pattern for any future integration test that exercises an audit-writing code
path: make the fixture **idempotent and permanent** for exactly the rows a real audit entry can
reference (tenant, users, their auth identities), and delete-and-recreate everything else that has
no audit_entries foreign key pointing at it:

- `beforeAll` finds the tenant by its fixed slug and reuses its id if present, otherwise creates it.
  Same for each user: look it up by `tenant_id` + `email` first; only call `auth.admin.createUser`
  and insert into `users` if it doesn't already exist.
- `practice_lines`, `pipeline_stages`, `accounts`, `user_roles`, `account_practice_owners` have no
  audit_entries FK pointing at them and their `afterAll` deletes genuinely succeed every time
  (confirmed against the real project) - these are still recreated fresh on every run.
- `deals` also has no audit_entries FK on `entity_id` (it's a loose polymorphic reference, not a
  real foreign key) - deleting deals between runs is safe and keeps `nextDealReference` starting
  back at `D-0001` each run.
- `afterAll` no longer attempts to delete `users`, `tenants`, or the Supabase Auth users at all -
  that attempt cannot succeed once an audit entry exists, so it's not attempted rather than left in
  as a no-op that reads as working.

There is nothing to clean up by hand: the tenant this produces (slug `m1-3-integration-test`) is
the intended permanent state, not a stray leftover.

One more wrinkle this surfaced: `public.users.id` has no DB-level foreign key to `auth.users(id)`,
so the two can drift independently. This suite's pre-fix `afterAll` had already deleted the Auth
identities (via `admin.deleteUser`, which is *not* blocked by `audit_entries` the way deleting the
`public.users` row is) before this fix landed, leaving `public.users` rows with no matching Auth
user - `signInWithPassword` then fails with "Invalid login credentials" even though the row is
"found". `findOrCreateUser` repairs this by checking `admin.getUserById` and, if missing,
recreating the Auth identity with that exact same id (`admin.createUser` accepts an explicit `id`
even though the JS client's `AdminUserAttributes` type doesn't declare it - confirmed directly
against this project's real Auth admin API) rather than a fresh random one, since every RLS policy
and the row's own primary key already commit to it.
