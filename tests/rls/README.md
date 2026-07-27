# RLS harness

Wired as a directory and a CI step (see `.github/workflows/ci.yml`) but intentionally empty in
M0.1. The harness needs a running Postgres with each role's database identity to connect as
(docs/05-test-strategy.md), which arrives in M0.2 alongside the `tenants`/`practice_lines`/`users`/
`user_roles` migration and the `current_tenant_id`/`has_role`/`entitled_practices`/`can_write`
helper functions in `db/schema.sql`.

**Rule that must hold from M0.2 onward:** adding a table without a corresponding RLS test file
fails CI.
