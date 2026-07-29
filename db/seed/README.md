# Seed

`seed.mjs` is the deterministic local/dev seed for M0.8 (docs/07-build-backlog.md), scoped to what
exists so far: `tenants`, `practice_lines`, `users`, `user_roles`. It creates two tenants and real
Supabase Auth users (via the Admin API) covering every role, so each one can actually sign in
through `/sign-in` rather than only existing as a database row.

## What it creates

| Tenant | Users |
|---|---|
| `acme-demo` (Acme Consulting) | `tenant-admin@acme-demo.test`, `executive@acme-demo.test`, `director@acme-demo.test`, `team-lead@acme-demo.test`, `bde-1@acme-demo.test`, `bde-2@acme-demo.test`, `suspended@acme-demo.test` (status `suspended`, for exercising denial) |
| `globex-demo` (Globex Advisory) | `tenant-admin@globex-demo.test` — minimal, just enough for cross-tenant isolation testing/demoing |

Password for every seeded user: `Demo-Password-1!`.

## Running

```
npm run db:seed
```

Requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`, and refuses to
run without an explicit confirmation flag (already wired into the npm script) - **never point this
at a real production project.** It's fully idempotent: re-running it deletes and recreates every
row and auth user matching the fixed slugs/emails above, rather than accumulating duplicates.

## What's deliberately not here yet

M0.8's full spec (docs/05-test-strategy.md's "Seed data" section, and the backlog line "`is_demo`
on every row, plus the CI assertion that demo rows never appear in a metric query") is broader than
this. `is_demo` only exists on `accounts`/`contacts`/`deals`/`leads`/`tasks`
(docs/01-domain-model.md), none of which are migrated yet, and there is no metric query for demo
rows to pollute until the analytics milestones (M7). Building either now would mean inventing a
schema column nothing calls for yet, or a test against code that doesn't exist. Both land
naturally once M1 (deals) and M7 (analytics) are reached - revisit this file and the backlog line
then, rather than treating M0.8 as fully closed out by this seed script alone.
