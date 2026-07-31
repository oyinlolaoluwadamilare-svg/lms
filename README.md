# Pipeline Intelligence

A multi-tenant workforce leads and pipeline management platform for professional-services
business development, being rebuilt from a greenfield specification set.

Start here, in order:

1. [`CLAUDE.md`](./CLAUDE.md) — project constitution. Highest authority in this repository.
2. [`docs/DECISIONS.md`](./docs/DECISIONS.md) — open questions blocking implementation, and
   decisions already made (some currently **provisional**, pending product-owner confirmation).
3. [`docs/07-build-backlog.md`](./docs/07-build-backlog.md) — the dependency-ordered milestone
   backlog (M0–M9). **M0 — Foundation is complete.** Current milestone: **M1 — Deals and pipeline**,
   through task M1.5.
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
direct connection).

**M1.2** (deal repository and domain logic) is in place: `src/domain/deal.ts` (`resolveProbability`,
`dealValue`, `weightedValue`, `formatDealReference` — all pure, per `docs/01-domain-model.md`'s
derived-values table and `docs/04-metric-definitions.md`'s exact formulas, never inventing one) and
`src/data/deals.ts` (`getDealWithStage`, `countDealsForTenant`, `nextDealReference`). Money is
`bigint` throughout (CLAUDE.md #9), and every money column is selected with an explicit `::text`
cast — verified directly against this project's real REST endpoint that PostgREST serialises a
bare `bigint` column as a JSON **number**, silently losing precision above
`Number.MAX_SAFE_INTEGER` before any TypeScript code runs; casting to text forces a JSON string
that parses exactly (`src/domain/money.ts`'s `parseMoneyMinor` is the one place that parse
happens). `reference`'s exact format (a per-tenant sequential `D-0001` style) is an inferred
default, not a confirmed decision — `docs/01-domain-model.md` names the field but no format is
specified anywhere, and it isn't a listed open question in `docs/DECISIONS.md`.

Repository code here is the first to run into a real architectural fork: `src/data` is built on
the Supabase JS client (PostgREST), which this container can't stand up locally (no Docker daemon
for `supabase start`), so integration tests for it run against the real hosted project rather than
a local Postgres, unlike `tests/rls`. `tests/integration/deals-repository.spec.ts` proves this,
including the large-value precision case, against its own dedicated tenant, torn down afterward —
see `tests/integration/README.md` for the two repository secrets (`SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`) the CI job needs before it will pass. No create/list/filter UI for
deals exists yet — see `docs/07-build-backlog.md` for M1.3 onward.

**M1.3** (create-deal flow) is in place: a Zod schema (`app/(app)/deals/new/schema.ts`) requiring
`ownerId` and `expectedCloseDate`, a server action (`app/(app)/deals/new/actions.ts`), and the
single-path service `createDeal` (`src/services/deals.ts`) — the "Unknown Author" state named in
`docs/07-build-backlog.md` is unrepresentable structurally, not just by validation: `authorId` is
never a parameter anywhere in `createDeal` or `insertDeal`'s input type, it is always `actor.id`.
`can(actor, "deal.create", ...)` is checked in the service before any insert is attempted, as a
second control independent of the `deals_insert` RLS policy from migration `0005` (CLAUDE.md #1);
every successful create writes an audit row via the same `writeAudit` single path M0.6 built
(CLAUDE.md #6). `page.tsx` originally imported four `src/data` repositories directly — a real
layering violation the boundaries lint rule (M0.1) caught immediately — fixed by adding
`getCreateDealFormOptions()` to `src/services/deals.ts` so `app` reaches `data` only through
`services`, per `CLAUDE.md` §4's layering rule.

`tests/integration/create-deal-service.spec.ts` exercises the entire real chain — a real Supabase
Auth sign-in, the real RLS-scoped session client, the real `can()` check, the real insert, the real
audit write — against the real hosted project, for both a bde creating a deal in their own practice
and an executive denied before any insert is attempted. Building it surfaced a real, non-obvious
architectural constraint, not just a test bug: once `createDeal` writes an `audit_entries` row, the
referenced user and tenant become **permanently un-deletable** (`audit_entries.actor_id`/`tenant_id`
are real foreign keys to `users`/`tenants`, and M0.6's `forbid_mutation()` trigger blocks deleting
the audit row itself for every role, including `service_role` — by design). A delete-and-recreate
teardown pattern silently failed against this the second time the suite ran (`error` on those
specific deletes went unchecked); the fix makes the tenant and its users a permanent,
find-or-create fixture instead, and only deletes `deals` and the rows with no `audit_entries`
foreign key pointing at them between runs. See `tests/integration/README.md` for the full
diagnosis, including a second, related bug it surfaced and repaired (`public.users.id` has no
foreign key to `auth.users.id`, so a since-fixed version of this same teardown had already deleted
one Auth identity while leaving its un-deletable `public.users` row behind). Verified by running the
full suite three times in direct succession, not just once — the exact repro that first surfaced
the bug.

**M1.4** (pipeline table view with filters) is in place: `src/data/deals.ts`'s `listDeals` joins
deals to their stage, account, practice line and owner (a real, verified case of PostgREST's
ambiguous-embed error — `deals` has five foreign keys into `users`, so `owner:users!owner_id(...)`
disambiguation is required, confirmed directly against the real REST endpoint) and filters by
stage, owner, practice line, account, client type, forecast category, status and an expected-close
date range — all pushed down to Postgres, all narrowing within whatever migration `0005`'s
`deals_select` RLS policy already allows a given role to see, never widening it. Money for display
uses a new `formatMoney` (`src/domain/money.ts`) that never converts `amountMinor` through a JS
`Number` — `BigInt.prototype.toLocaleString` formats an arbitrarily large integer exactly, unlike
`Intl.NumberFormat`'s currency formatting, which takes a `Number` and would silently reintroduce
the precision loss CLAUDE.md #9 forbids.

`docs/06-ui-spec.md`'s Pipeline screen names an "advanced filter set" that also includes "days
since last engagement", "has no next step" and "stage regression" — each depends on an entity or
milestone that doesn't exist yet (an activity/task log for the first two, M2's `stage_events` table
and its regression-derived column for the third; `docs/07-build-backlog.md` schedules all of that
for M2 onward). Building filters against columns that are null for every row today, or a column
that doesn't exist at all, would look like a real feature while silently doing nothing — deferred
and documented here rather than faked, per CLAUDE.md's "do not start a milestone whose predecessor
is incomplete" and "say when something is a bad idea," the same reasoning M0.8 already established
for a comparable scope cut.

Verified against the real hosted project, not just written and assumed:
`tests/integration/pipeline-list.spec.ts` signs in as two bdes in different practice lines and an
executive, proving RLS scoping is real (each bde sees only their own practice's deal; the executive
sees both) and that every filter narrows correctly; run three times in direct succession with no
manual cleanup, since this fixture never calls `createDeal` and so never hits the permanent-fixture
constraint M1.3 found. `tests/e2e/pipeline.spec.ts` drives the actual running app in a real browser
against a real seeded account (`db/seed/seed.mjs`), confirming the page itself renders correctly
end to end — including the case its own seed data leaves untested elsewhere, zero `pipeline_stages`
and zero `accounts` rows (M0.8 predates M1.1), which exercises the empty-filter-options and
zero-deals paths for real. Building that test surfaced a pre-existing gap in CI, not something this
task introduced: the `e2e` job never had Supabase credentials wired up at all, even though
`auth.spec.ts`'s reset-password test already needed them — fixed by adding the same secrets pattern
the `integration` job already uses, plus a new `SUPABASE_ANON_KEY` secret e2e needs that integration
never did (browser sign-in uses the anon key; the integration job only ever uses the service-role
client). See `tests/e2e/README.md`.

**M1.5** (pipeline board view with drag) is in place: `src/services/deals.ts`'s `changeStage` is
the single path a deal's stage ever changes through (docs/03-architecture.md), called today only by
the board's drag handler (`app/(app)/deals/actions.ts`'s `changeStageAction`, a server action a
client component calls directly). `authorId`-style pinning applies here too: the target stage must
be an `open`-type stage, checked and refused server-side (`code: "target_is_closing_stage"`), not
merely hidden as a drop target in the UI (CLAUDE.md #1) — moving a deal into a won/lost stage is
`closeDeal`'s exclusive job (docs/07-build-backlog.md M5.2, not built yet, and the only path that
will ever collect the outcome reason that transition requires). `can()` is checked independently of
migration 0005's `deals_update` RLS policy, and every successful move writes an audit row via the
existing `writeAudit` single path.

Two real, non-obvious bugs surfaced by testing against the real project rather than assuming
correctness:

- `getDealForStageChange` reads through the *caller's own* RLS-scoped session, so a bde outside the
  deal's practice can't see the row at all — `changeStage` correctly reports `not_found`, not
  `denied`, for that case (the same not-confirming-existence-to-an-unauthorised-caller shape a
  404-instead-of-403 API response uses). Confirmed both cases are handled correctly by testing a
  *third* user, a same-practice non-owner bde, who genuinely gets `denied` after the read succeeds.
- Neither `deals` nor `accounts` ever had anything maintaining `updated_at`/`updated_by` -
  `changeStage`'s update was the first application write path against either table, which made this
  visible. Fixed with migration `0006_updated_at_trigger`, setting both from `auth.uid()` rather
  than trusting a caller-supplied value (mirroring how `author_id` is protected). Verified locally,
  forward and backward, against a real per-user Postgres session
  (`tests/rls/deals_foundation.spec.ts`) — **not yet mirrored onto the real hosted project**, since
  this container has neither raw-TCP Postgres egress nor a Management API token in this session;
  flagged in `db/migrations/README.md` as an outstanding manual step, the same way the CI secrets
  gaps were flagged in M1.2/M1.4.

Manually verifying the board in a real browser against real seeded data surfaced a third, more
far-reaching finding: exercising `changeStage` against a seeded demo user (`bde-1@acme-demo.test`)
during that QA pass permanently pinned the `acme-demo` tenant the same way M1.3 found for
integration-test tenants — `db/seed/seed.mjs` had never been updated for this (it predates any
audit-writing feature) and its delete calls were failing silently, breaking `npm run db:seed`
outright on the next run. Fixed properly rather than avoided: `seed.mjs`'s `ensureTenant`/
`ensureUserWithRole` now detect an undeletable tenant/user and reuse it instead of failing, and the
script was extended to also clean up the M1.1 tables (`accounts`, `pipeline_stages`, `deals`,
`account_practice_owners`) it had never touched. Verified by re-running `db:seed` twice against the
real project in this now-permanently-pinned state and confirming a real sign-in still works
afterward — see `db/seed/README.md` for the full account and the practical implication for anyone
doing manual QA against seeded data.

Verified end to end, not just at the service layer: `tests/integration/pipeline-list.spec.ts` signs
in as real users to prove RLS scoping and the `denied`/`not_found` distinction above, and a manual
pass drove the actual running app in a real browser with a real HTML5 drag gesture (mouse
down/move/up, not a synthetic event), confirmed by screenshot and by querying the real database
directly afterward that the dragged card's `stage_id` had genuinely changed.

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
