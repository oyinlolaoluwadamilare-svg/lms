# RLS harness

Connects as each role's real database identity, with the application layer bypassed entirely
(docs/05-test-strategy.md). `foundation.spec.ts` proves M0.2's exit criterion: cross-tenant
isolation on `tenants`/`practice_lines`/`users`/`user_roles`, the executive identity failing every
write, a suspended user denied despite holding role rows, and the `role_scope_valid` constraint.

`cross_tenant_isolation.spec.ts` proves M0.5's exit criterion: every one of the five role
identities (`tenant_admin`/`executive`/`director`/`team_lead`/`bde` — the first two were the only
ones exercised until M0.5) reads zero rows of another tenant's data, on every one of the four
existing tables, as an explicit matrix rather than a few spot-checked cases. The guardrail was
verified to actually fire, not just look correct: `alter table tenants disable row level
security` made every identity's isolation test fail immediately, and re-enabling it restored a
clean pass.

**Rule that must hold from here on:** adding a tenant-scoped table without a corresponding RLS
test file in this directory fails CI (see the `rls` job in `.github/workflows/ci.yml`).

## Running locally

```
npm run db:setup:local   # creates local roles/db, applies migrations + the auth shim + grants
npm run test:rls
```

`db:setup:local` (`scripts/db-setup-local.sh`) is safe to re-run. It assumes a local Postgres
server is already running (`pg_lsclusters` / `sudo service postgresql start` on a native install).
Override `PSQL_SUPERUSER_CMD`, `MIGRATOR_DATABASE_URL` and `AUTHENTICATED_DATABASE_URL` to point at
a different Postgres (e.g. a Docker service container — see the `rls` CI job for the exact env
this needs over TCP instead of local peer auth).

## Why this needs its own shim

`db/schema.sql` and the migrations call `auth.uid()` exactly as they would on real Supabase, which
already provides that function. Plain Postgres doesn't, so
`tests/rls/fixtures/local_auth_shim.sql` provides a compatible stand-in that reads the same
`request.jwt.claim.sub` GUC PostgREST sets per request. It is applied only by
`db-setup-local.sh`/CI, never checked in as a real migration, and must never be pointed at an
actual Supabase project.
