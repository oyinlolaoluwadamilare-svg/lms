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

`audit_log.spec.ts` proves M0.6's exit criterion: no `authenticated` identity of any role can
insert into or mutate `audit_entries` (it's written by the service_role only), read access matches
`admin.view_audit_log` (tenant_admin/executive/director only, scoped to their own tenant), and -
the case this milestone exists for - update and delete raise for every identity, including the
migrator/superuser identity that owns the table and would otherwise bypass RLS entirely. That last
guarantee is a trigger, not a policy, and was verified manually against a live local Postgres
(`update`/`delete` as the `postgres` superuser both raised "append-only") before this file existed
to make it a permanent, automated check.

`deals_foundation.spec.ts` proves M1.1's exit criterion for the new tables it adds
(`pipeline_stages`/`accounts`/`account_practice_owners`/`deals`/`deal_co_owners`): the
`active_deal_requires_owner_and_date` constraint rejects an active deal missing either field but
allows an `on_hold` one missing both; cross-tenant isolation; D-02's practice-wide-read/own-write
shape on deals (a bde reads a practice-mate's deal but can't update it, the owning bde can,
team_lead/director can update any deal in their practice); accounts' practice-scoped visibility via
`account_practice_owners` (owned in a practice you're not entitled to, invisible; tenant_admin sees
everything); and pipeline_stages' tenant-wide-read/tenant_admin-only-write shape. This is a
baseline, not the exhaustive per-role-action matrix - that's M1.8's own later, separately-flagged
(⚑) milestone, not duplicated here. Writing this file caught two real bugs on the first run, not
by inspection: adding RLS to `deal_co_owners`/`account_practice_owners` (see migration
`0005_pipeline_stages_accounts_deals`'s own notes) created a circular RLS dependency with
`deals`/`accounts` ("infinite recursion detected in policy"), fixed with `security definer` helper
functions; and a test's own cleanup step tried to `DELETE` as an `authenticated` client, which
correctly has no delete grant on anything (CLAUDE.md #3) - fixed by cleaning up via the migrator
instead, since that's not something a real user session should be able to do anyway.

**Note on running the whole suite together:** every spec file's `seed()` truncates the same shared
tables against one physical local Postgres. Vitest runs spec files in parallel by default, and
concurrent `TRUNCATE ... CASCADE` across files can deadlock (this surfaced for real once a third
RLS spec file existed) - `vitest.rls.config.ts` sets `fileParallelism: false` to serialize them.
Don't remove that without re-verifying concurrent runs don't deadlock.

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
