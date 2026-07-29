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
even on assertion failure paths that don't throw during cleanup. If a run is interrupted before
teardown (a killed process, a crashed CI runner), the next run's setup will collide on the tenant's
unique slug - if that happens, delete the stray tenant by hand (cascade: `user_roles` -> `users` ->
`account_practice_owners` -> `accounts` -> `pipeline_stages` -> `deals` -> `tenants`) rather than
weakening the slug to something non-deterministic.
