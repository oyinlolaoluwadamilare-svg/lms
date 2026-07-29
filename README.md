# Pipeline Intelligence

A multi-tenant workforce leads and pipeline management platform for professional-services
business development, being rebuilt from a greenfield specification set.

Start here, in order:

1. [`CLAUDE.md`](./CLAUDE.md) — project constitution. Highest authority in this repository.
2. [`docs/DECISIONS.md`](./docs/DECISIONS.md) — open questions blocking implementation, and
   decisions already made (some currently **provisional**, pending product-owner confirmation).
3. [`docs/07-build-backlog.md`](./docs/07-build-backlog.md) — the dependency-ordered milestone
   backlog (M0–M9). **M0 — Foundation is complete.** Current milestone: **M1 — Deals and pipeline**,
   through task M1.1.
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
`postgres` superuser both raised) before being turned into a permanent test.

**M0.7** (design tokens, layout shell, role-aware navigation, standard states) is in place: an
`app/(app)` route group with a persistent shell (`src/ui/shell/AppShell.tsx`) and role-derived
navigation (`src/domain/navigation.ts`, matching `docs/06-ui-spec.md`'s per-role nav table
verbatim, merged across every role a user holds) landing bde/team_lead on My Work and everyone
else on Dashboard. The four standard states from `docs/06-ui-spec.md`
(`src/ui/states/{LoadingSkeleton,EmptyState,ErrorState,DeniedState}.tsx`) are wired to real
integration points rather than demoed in isolation: `loading.tsx`/`error.tsx` use Next's own
loading-UI and error-boundary conventions, and `DeniedState` is the actual server-side gate when a
role directly navigates to a route outside their nav — hiding a link is presentation only and
never the sole control (CLAUDE.md #1). Verified against a real signed-in session (a temporary test
tenant and two test users created via the Supabase Admin API, exercised through the real sign-in
flow, then deleted): correct nav per role, correct default landing, and a `bde` identity denied
`/admin` and `/team` by direct URL even though its own nav never links to them.

**M0.8** (seed script) is in place, deliberately scoped down from its full spec —
`db/seed/seed.mjs` (`npm run db:seed`) deterministically creates two tenants and real Supabase
Auth users covering every role, including a suspended one, so any of them can sign in for real
rather than only existing as rows. The rest of M0.8's stated scope (`is_demo` on every row, a CI
assertion that demo rows never appear in a metric query) is **not** built yet: `is_demo` only
exists on `accounts`/`contacts`/`deals`/`leads`/`tasks` (`docs/01-domain-model.md`), none of which
are migrated, and there is no metric query for demo rows to pollute until the analytics milestones
(M7) — inventing either now would mean a schema column nothing calls for yet, or a test against
code that doesn't exist. See `db/seed/README.md` for the full accounting of what's deferred and
why. Verified against the real project, not just written and assumed: ran the seed script twice
(confirming idempotent re-seeding), then signed in through the real app as the seeded director
(correct nav, correct tenant name) and the seeded suspended user (correctly redirected to
`/account-suspended`).

This is where M0 ends: an authenticated user of each role sees a correct, empty shell; every
permission pair is tested; cross-tenant isolation is proven.

## M1 — Deals and pipeline

**M1.1** (`pipeline_stages`/`accounts`/`deals`/`deal_co_owners` migrations) is in place — migration
`0005_pipeline_stages_accounts_deals`, per `db/schema.sql`, with `active_deal_requires_owner_and_date`
(an active deal cannot exist without both an owner and an expected close date) and
`account_practice_owners` (D-03: one owner per account-practice-line relationship, not a single
global owner). Two deliberate deviations from `db/schema.sql`, not silently reproduced: it never
enables RLS on `pipeline_stages`/`accounts`/`account_practice_owners`/`deal_co_owners` at all
(CLAUDE.md #2 requires it regardless, so all four get it here); and its own accounts/deals table
definitions omit `updated_by` against its own stated general rule that every mutable table carries
one. Adding RLS to `deal_co_owners`/`account_practice_owners` — which the reference schema had
skipped — created a real, caught-by-actually-running-the-tests bug: a circular RLS dependency with
`deals`/`accounts` ("infinite recursion detected in policy"), fixed with `security definer` helper
functions mirroring the pattern `current_tenant_id()`/`has_role()` already established.
`tests/rls/deals_foundation.spec.ts` proves the constraint, cross-tenant isolation, D-02's
practice-wide-read/own-write shape on deals, and accounts' practice-scoped visibility through
`account_practice_owners` — a baseline, not the exhaustive per-role-action matrix that M1.8 (⚑,
its own later milestone) will build. Verified against a real local Postgres, forward and backward,
and mirrored onto the real Supabase project (this container still has no raw-TCP egress for a
direct connection). No repository, domain logic or UI for deals exists yet — see
`docs/07-build-backlog.md` for M1.2 onward.

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
