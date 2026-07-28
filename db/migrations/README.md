# Migrations

Sequential, numbered, reviewed pairs: `NNNN_name.up.sql` / `NNNN_name.down.sql`. Applied in order by
`db/migrate.mjs`, which tracks applied versions in a `schema_migrations` table it creates on first
run. Every migration must be reversible (CLAUDE.md, definition of done: "migration tested forward
and backward against seeded data") — a migration with no meaningful rollback still gets a `.down.sql`
that at least drops what it created.

Migrations are schema-only and portable to a real Supabase project as-is. They deliberately do
**not** create the `authenticated` Postgres role or the `auth` schema/`auth.uid()` function -
Supabase already provides both. For local development and CI, `scripts/db-bootstrap-local.sh`
creates a compatible local stand-in (see `tests/rls/fixtures/local_auth_shim.sql`); that stand-in
is never applied to a real Supabase database.

## Usage

```
DATABASE_URL=postgres://app_migrator:...@localhost:5432/pipeline_intelligence npm run db:migrate
DATABASE_URL=postgres://app_migrator:...@localhost:5432/pipeline_intelligence npm run db:migrate:down
```

`db:migrate` applies every not-yet-applied migration, in order, each inside its own transaction.
`db:migrate:down` rolls back exactly one migration (the most recently applied) - run it repeatedly
to unwind further.

## What exists so far

| Migration | Milestone | Contents |
|---|---|---|
| `0001_extensions_and_enums` | M0.2 | `uuid-ossp`, `citext`; the `user_status` and `app_role` enums |
| `0002_tenancy` | M0.2 | `tenants`, `practice_lines`, `users`, `user_roles` |
| `0003_rls_foundation` | M0.2 | `current_tenant_id`/`has_role`/`entitled_practices`/`can_write`; RLS on all four tables above |

Every later migration that adds a tenant-scoped table ships RLS in the same migration - a table
without RLS does not ship (CLAUDE.md #2). `db/schema.sql` remains the full canonical reference this
directory is progressively implementing, per its own header comment.
