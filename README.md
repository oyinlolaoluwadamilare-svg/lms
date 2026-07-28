# Pipeline Intelligence

A multi-tenant workforce leads and pipeline management platform for professional-services
business development, being rebuilt from a greenfield specification set.

Start here, in order:

1. [`CLAUDE.md`](./CLAUDE.md) — project constitution. Highest authority in this repository.
2. [`docs/DECISIONS.md`](./docs/DECISIONS.md) — open questions blocking implementation, and
   decisions already made (some currently **provisional**, pending product-owner confirmation).
3. [`docs/07-build-backlog.md`](./docs/07-build-backlog.md) — the dependency-ordered milestone
   backlog (M0–M9). Current milestone: **M0 — Foundation**, through task M0.4.
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
including tenant_admin). No product tables, routes or features beyond auth/permissions exist yet —
see `docs/07-build-backlog.md` for what M0.5 onward brings.

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
