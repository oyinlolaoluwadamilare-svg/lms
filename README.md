# Pipeline Intelligence

A multi-tenant workforce leads and pipeline management platform for professional-services
business development, being rebuilt from a greenfield specification set.

Start here, in order:

1. [`CLAUDE.md`](./CLAUDE.md) — project constitution. Highest authority in this repository.
2. [`docs/DECISIONS.md`](./docs/DECISIONS.md) — open questions blocking implementation, and
   decisions already made (some currently **provisional**, pending product-owner confirmation).
3. [`docs/07-build-backlog.md`](./docs/07-build-backlog.md) — the dependency-ordered milestone
   backlog (M0–M9). Current milestone: **M0 — Foundation**, through task M0.6.
4. [`docs/08-prompt-playbook.md`](./docs/08-prompt-playbook.md) — session-by-session prompts for
   driving the build.
5. [`docs/reference/pipeline-intelligence-benchmark-and-prd-v1.html`](./docs/reference/pipeline-intelligence-benchmark-and-prd-v1.html) —
   the source benchmark assessment and PRD this rebuild is derived from.

## Status

**M0.1** (repository scaffold) is in place: Next.js App Router, TypeScript strict, Tailwind wired to
the design tokens in `docs/06-ui-spec.md`, Vitest, Playwright, an ESLint rule that fails the build
on a layering violation (`domain` importing from `data`/`services`/`app`/`ui`), and CI running
typecheck, lint and the wired test suites.

**M0.2** (tenancy/RLS foundation) is in place: `tenants`/`practice_lines`/`users`/`user_roles` as
reversible migrations (`db/migrations`) with the `current_tenant_id`/`has_role`/
`entitled_practices`/`can_write` helpers, RLS enabled on all four tables, and
`tests/rls/foundation.spec.ts` proving cross-tenant isolation, the executive identity failing
every write, a suspended user denied despite holding role rows, and the `role_scope_valid`
constraint — connecting as each role's real database identity with the application layer
bypassed entirely.

**M0.3** (auth) is in place: Supabase-Auth-backed sign-in, password reset and session handling via
`middleware.ts` and `src/services/session.ts`, and suspended/inactive-user denial enforced by RLS
itself rather than application logic (`getSessionUser` treats "no matching active `users` row" as
denied and tears the session down). No self-service account creation — public signup is disabled
at the Supabase project level, not just omitted from the UI.

**M0.4** (permission matrix) is in place: `docs/02-permission-matrix.md` as typed data in
`src/auth/permissions.ts` (every action string in the document as a literal union — a missing one
is a TypeScript compile error, not just a test failure) plus the `can(actor, action, resource)`
guard, with `tests/permissions/matrix.spec.ts` proving every role-action pair is covered and named
deny/allow cases from the document (bde can log an activity on an owned or co-owned deal but not
any other's; bde can assign a task to a practice peer but not outside it; executive cannot write
anything; no role can delete an activity, hard-delete, or connect another user's mailbox; a
suspended or inactive user is denied everything; cross-tenant access is impossible for every role
including tenant_admin).

**M0.5** (RLS test harness) is in place: `tests/rls/cross_tenant_isolation.spec.ts` proves cross-
tenant isolation as an explicit matrix across every one of the five role identities x every one of
the four existing tables — `director` and `team_lead` were entirely untested by M0.2's suite,
which only exercised `tenant_admin`, `executive` and `bde`. Verified live, not just by inspection:
disabling RLS on `tenants` made every identity's isolation test fail immediately; re-enabling it
restored a clean pass.

**M0.6** (audit service) is in place: `audit_entries` (migration `0004_audit_log`) is genuinely
append-only — a `forbid_mutation()` trigger, not merely an RLS policy, blocks `update`/`delete` for
every identity including the table-owning superuser (RLS alone would not stop that role, since
RLS never restricts a table's owner or a `bypassrls` role, and `service_role` has one). Matching
`db/schema.sql`'s own design, the table has no insert policy at all — only `src/services/audit.ts`'s
`writeAudit()`, the single path, writes a row, using a service-role client
(`src/lib/supabase/service.ts`) precisely because no RLS-permitted client-side write path exists
for this table. `tests/rls/audit_log.spec.ts` proves no authenticated identity of any role can
insert or mutate a row and that read access matches `admin.view_audit_log`; the append-only
guarantee was also verified by hand against a live local Postgres (`update`/`delete` as the
`postgres` superuser both raised) before being turned into a permanent test. No product tables,
routes or features beyond auth/permissions/audit exist yet — see `docs/07-build-backlog.md` for
what M0.7 onward brings.

## Commands

```
npm install
npm run dev             # local dev server
npm run typecheck
npm run lint
npm run test             # unit + permission-suite + layering-guardrail tests (Vitest)
npm run test:e2e         # Playwright
npm run db:setup:local   # local Postgres: roles/db, migrations, RLS test shim, grants
npm run test:rls         # RLS foundation suite (needs db:setup:local first)
npm run db:migrate       # apply pending migrations (DATABASE_URL required)
npm run db:migrate:down  # roll back the most recently applied migration
```
