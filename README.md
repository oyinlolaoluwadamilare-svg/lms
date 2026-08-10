# Pipeline Intelligence

A multi-tenant workforce leads and pipeline management platform for professional-services
business development, being rebuilt from a greenfield specification set.

Start here, in order:

1. [`CLAUDE.md`](./CLAUDE.md) — project constitution. Highest authority in this repository.
2. [`docs/DECISIONS.md`](./docs/DECISIONS.md) — open questions blocking implementation, and
   decisions already made (some currently **provisional**, pending product-owner confirmation).
3. [`docs/07-build-backlog.md`](./docs/07-build-backlog.md) — the dependency-ordered milestone
   backlog (M0–M9). **M0 — Foundation is complete.** **M1 — Deals and pipeline is complete.**
   **M2 — Engagement history is complete** (staleness colour, M2.3's other half, is deliberately
   deferred to M3.7 — see the `## M2` section below). Current milestone: **M3 — Engagement
   timeline** ⚑, through task M3.5 — see the `## M3` section below.
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

**M1.6** (deal detail read-only skeleton) is in place at `/deals/[id]`: `src/data/deals.ts`'s
`getDealDetail` joins a deal to its stage, account, practice line, owner, author and co-owners
(a real, verified nested PostgREST embed — `deal_co_owners(user:users!user_id(full_name))` —
confirmed against the live REST endpoint) and reads through the caller's own RLS-scoped session,
the same as `listDeals`; a nonexistent deal and a deal outside the caller's RLS visibility both
return `null`, deliberately not distinguished, the same reasoning `changeStage`'s `not_found` case
already established. The page renders exactly the four sections `docs/07-build-backlog.md` M1.6
asks for — header, financial summary, details, account — and deliberately nothing else:
`docs/06-ui-spec.md`'s full Deal detail spec also calls for an engagement timeline, stakeholders,
open tasks, a next-action strip, a last-engaged chip, and primary action buttons (Log Activity, Add
Task, Edit Deal, Advance Stage, Mark Won/Lost, Escalate, Add Contact) — every one of those depends
on an entity or action that doesn't exist yet (activities: M3+; tasks: M4+; edit: M1.7; mark
won/lost: M5.2–M5.3), so building any of them now would render fake functionality on every deal, the
same reasoning M1.4's filter set and M1.5's stage-transition restriction already applied. The
table/board views' deal links (deliberately left as plain text back in M1.4, since `/deals/[id]`
didn't exist yet) are re-enabled now that it does.

Building this surfaced one real, unrelated defect this task fixed rather than routed around: adding
the `[id]` route made `eslint`'s `@next/next/no-html-link-for-pages` rule newly flag two existing
static-string `<a href="/deals">`/`<a href="/deals/new">` anchors that had never been caught before.
Rather than patch just those two, every internal-navigation `<a>` across the app (the auth flows'
back-links, the primary nav sidebar, `EmptyState`'s action link, and the deals feature's own links)
was converted to `next/link`'s `Link` — the correct fix regardless of which specific instances the
linter happened to flag, and the linter existing specifically to enforce this Next.js best practice.
That conversion then surfaced a second, genuinely interesting finding while writing the e2e test for
the view-toggle links: simulating a click on one of these `Link`s and waiting for the resulting
client-side RSC transition proved to be flaky specifically in this container (reproduced repeatedly,
including with `prefetch={false}` added — a legitimate improvement in its own right, since every
destination here is a fully dynamic, per-session, RLS-gated page that gains nothing from
prefetching — and a race-free `Promise.all([waitForURL, click])` instead of click-then-assert).
A full page load of either URL always renders correctly; only the simulated-click-triggered
client-side transition was unreliable here. Rather than keep fighting a browser-automation timing
issue that doesn't reflect a real app defect, the toggle's pure href-building logic was extracted to
`src/lib/pipelineViewLinks.ts` and unit-tested directly and deterministically
(`tests/unit/pipelineViewLinks.spec.ts`), and the e2e test now asserts the rendered `href` and a
direct full-page load of the target URL instead of a simulated click - see that test's own comment.

Verified: `tests/integration/pipeline-list.spec.ts`'s `getDealDetail` suite proves the join and both
the RLS-visible and RLS-excluded cases against the real hosted project; a manual browser pass (seed
data created and torn down without ever calling an audit-writing action, so it left no permanent
trace) confirmed the rendered page matches the design - including that the financial summary
correctly weights the *negotiated* value over the proposal value once both are set, per
`docs/04-metric-definitions.md`. Full suite green: typecheck, lint, unit (76 tests), integration (24
tests), RLS (79 tests), and the Playwright e2e suite (10 tests, re-run repeatedly to confirm the
view-toggle fix actually resolved the flake rather than merely hiding it).

**M1.7** (edit deal, with audit entries on every field change) is in place at `/deals/[id]/edit`,
linked from the detail page's new "Edit deal" button (shown only when `can()` says so - a real,
resource-scoped control, not a hidden link standing in for one). `src/services/deals.ts`'s
`updateDeal` is the single path: it diffs the submitted values against the current row field by
field and writes exactly one `audit_entries` row per edit whose `before`/`after` contain *only* the
fields that actually changed - every field that changes is captured, but a field nobody touched
isn't noise in the diff, and a no-op submit (identical values) writes no audit row at all, since
CLAUDE.md #6 requires an entry for every *state change* and a submit that changes nothing is not
one. Deliberately scoped to the fields plain `deal.update` covers - name, client type, expected
close date, proposal value, negotiated value, brief. Three other deal fields are each gated by
their own distinct permission action and are out of scope here, not silently folded in: owner
(`deal.change_owner` - a bde structurally cannot do this, unlike every field this form does cover),
co-owners (`deal.add_co_owner`), and forecast category (`deal.override_forecast_category`, which the
schema itself ties to an `override_reason` column with no business rule specified anywhere in
`docs/` for when a reason is required - an open question, not silently assumed one way or the
other). Stage remains exclusively `changeStage`'s (M1.5).

Verified against real, RLS-scoped sessions covering every angle the permission matrix implies for
this fixture: the deal's owner (allowed), a co-owner who isn't the owner (also allowed - `own` scope
includes co-owners, same as `changeStage`'s), a same-practice bde who is neither (denied - a real
`can()` denial, confirmed distinct from the next case by first proving they *can* see the deal),
and a bde from a different practice (`not_found` - RLS excludes the row before `can()` ever runs,
same reasoning as `changeStage`'s `not_found` case) and an executive (sees the deal tenant-wide, but
genuinely denied - `deal.update` is `null` for that role). A manual browser pass drove the actual
running app end to end - opened a seeded deal, clicked through to the edit form, confirmed every
field was correctly prefilled (including the money fields via the new `toMajorUnitsString`, the
exact inverse of `toMinorUnits`, round-trip-tested in `tests/unit/deal.spec.ts`), submitted a real
change, and confirmed both the updated detail page (weighted forecast recalculated correctly) and
the resulting `audit_entries` row (containing only the two fields that had actually changed)
directly against the database. Full suite green: typecheck, lint, unit (80 tests), integration
(29 tests, re-run twice to confirm idempotency), RLS (79 tests), e2e (11 tests).

**M1.8** ⚑ (permission and RLS tests for every deal action, allow and deny, per role) is in place,
closing out M1. Two new files, one per layer, both explicitly deferred by earlier milestones'
own comments until this one:

`tests/permissions/deal-matrix.spec.ts` exhaustively tests `can()` for all 13 `deal.*` actions
across all 5 roles (65 combinations) against four resource shapes that cover every scope boundary
`docs/02-permission-matrix.md`'s tokens name - a deal the actor owns, a colleague's deal in the same
practice, a deal in a different practice, and a deal in a different tenant - with the expected
outcome for each shape *independently re-derived* from the scope token(s) a role-action pair grants,
not copied from `can()`'s own implementation (a circular test would prove nothing). Named cases on
top of the generated table single out the most important specific facts this matrix encodes: `bde`
can never change a deal's owner even on a deal they own themself (the one deal action where owning
it isn't enough - `team_lead`/`director` can, even on a colleague's deal); only `director` and
`tenant_admin` can override a stage gate; only `tenant_admin` can restore a soft-deleted deal; and
executive is denied every write action on every resource shape while retaining tenant-wide view.

`tests/rls/deals_permission_matrix.spec.ts` proves the same boundary at the database level -
`deals_select`/`deals_update`/`deals_insert`, six identities (an owner, a same-practice colleague,
`team_lead`, `director`, `executive`, `tenant_admin`) against three deals (own practice, a different
practice in the same tenant, a different tenant). This surfaced the real asymmetry between reading
and writing that D-02 names but this is the first place it's exhaustively proven: a `bde` reads
their *whole* practice (`deals_select` has no owner check at all) but writes only their own
(`deals_update`'s `bde` branch is `owner_id/author_id/is_deal_co_owner`, not practice-wide) - and a
genuine, load-bearing architectural limitation, demonstrated rather than glossed over: migration
0005's `deals_update` policy is *one* policy shared by every specific write action in the permission
matrix (`change_stage`, `change_owner`, `mark_won`, `override_forecast_category`, ...) - it has no
concept of "which column changed," only "may this identity write to this row at all." A dedicated
test proves a `bde` who owns a deal **can** reassign its `owner_id` via a raw `UPDATE`, even though
`docs/02-permission-matrix.md` says `bde`'s `deal.change_owner` is always denied - RLS is the coarse,
row-level backstop; the fine-grained per-action distinction exists only in `can()`, which is exactly
why `src/services/deals.ts`'s `changeStage`/`updateDeal` each call `can()` themselves rather than
trusting `deals_update` alone (CLAUDE.md #1: RLS is a second, independent control, never the only
one). Also confirms an `INSERT` policy violation behaves differently from a `SELECT`/`UPDATE` one -
Postgres actively rejects the whole statement ("new row violates row-level security policy") rather
than silently returning/affecting zero rows, which the test helper handles explicitly rather than
mistaking a thrown error for an unrelated bug.

Verified: both new files pass in full (70 and 20 tests respectively) alongside every existing suite
- typecheck, lint, unit (150 tests total), RLS (99 tests total, all five files together), and a
re-run of `test:integration` and the full Playwright e2e suite confirming this test-only milestone
introduced no regressions anywhere else.

## M2 — Engagement history

**M2.1/M2.2** (`stage_events` table, immutability triggers, the regression-derived column, and
refactoring `changeStage` to write exactly one event per transition) are complete and verified
against the real hosted project, not just locally.

Migration `0007_stage_events` follows `db/schema.sql`'s own column list exactly - one deliberate
deviation, called out rather than silently reproduced: `docs/01-domain-model.md` specifies
`is_regression` as "generated: `to_stage.sort_order < from_stage.sort_order`," but a Postgres
`generated` column can only reference the *same row's* other columns, never another table's -
`db/schema.sql` itself already reflects this (`is_regression boolean not null default false`, not a
generated column). This migration computes both `is_regression` and
`duration_in_previous_seconds` in a `before insert` trigger instead - CLAUDE.md #7 ("derived fields
are computed transactionally on write, never by nightly batch") is satisfied by the trigger being
authoritative and running inside the insert, not by the column being `generated`. `is_regression` is
always trigger-computed (it depends only on the two stages' `sort_order`, not timing);
`duration_in_previous_seconds` is only trigger-computed for a *live* event
(`is_reconstructed = false`) - a future backfill tool (not built) supplies its own value for
migrated history, which the trigger leaves untouched.

RLS mirrors `deals_select`'s scope shape exactly (tenant-wide for `tenant_admin`/`executive`,
practice-entitled otherwise) - via the `deal_tenant_id()`/`deal_practice_line_id()` security-definer
helper functions from migration 0005, not `db/schema.sql`'s own literal
`exists (select 1 from deals d where d.id = deal_id and ...)`, which would reintroduce the exact
cross-table RLS recursion ("infinite recursion detected in policy") migration 0005 already found and
fixed for `deal_co_owners` the same way. No insert/update/delete policy for `authenticated` at all -
service_role only, the same immutable-history shape `audit_entries` already established, plus
`forbid_mutation()` (migration 0004) reused as `trg_no_update_stage_events`.

`src/services/deals.ts`'s `changeStage` now calls the new `src/services/stageEvents.ts`'s
`writeStageEvent` alongside its existing `writeAudit` call, on every successful move - the single
path M2.2 requires. Board drag (via `changeStage`) is the only real transition path that exists in
this codebase today; M2.2's stated scope names five more paths to test ("form, board, API, bulk,
mark-won, mark-lost") that don't yet exist here - the edit form (M1.7) deliberately excludes stage,
there is no API or bulk-action surface, and mark-won/mark-lost belong to `closeDeal` (M5.2, not
built) - so only board-drag is actually wired or tested this milestone; each future path is required
to route through this same `changeStage`, never to reimplement any part of it.

New `tests/rls/stage_events.spec.ts` (13 tests) proves the trigger's own arithmetic directly against
local Postgres, independent of `changeStage`: duration falls back to the deal's `created_at` when no
prior event exists, is computed from the true prior event once one does, `is_regression` flips
correctly in both directions and is `false` for a null `from_stage_id`, a reconstructed event's
supplied duration is trusted rather than overwritten, both `update` and `delete` are blocked for
every writer including the table-owner migrator connection, and the select policy's practice/tenant
scoping and complete absence of an insert policy are both verified per identity.

**Real-project gap closed.** This container still has no raw-TCP Postgres egress, but a Supabase
Management API Personal Access Token was supplied in this session - the same mechanism `0005` used -
so both migration `0007` and the still-outstanding `0006` were applied to the real hosted project
(`schema_migrations` there now lists `0001` through `0007`).

Applying `0007` surfaced a real, verified fixture bug, not a hypothetical: `stage_events.deal_id` is
a real FK (no cascade), and `stage_events` is itself immutable (`forbid_mutation` blocks delete for
every role including service_role), so once `changeStage`'s test writes a `stage_events` row for the
advisory deal, that deal - and transitively the account/practice-line/stage rows it references -
becomes permanently un-deletable too, the same way `audit_entries` already pins the tenant/users
(see `tests/integration/support/permanentFixture.ts`). The fixture in `pipeline-list.spec.ts` was
delete-and-recreate for practice lines/stages/accounts/deals before this milestone; run twice in a
row for real, that silently left duplicate rows accumulating on the hosted project every run
(Postgres rejects the whole multi-row `DELETE` on the one FK-violating row, and supabase-js's
`.delete()` resolves with an unchecked `{error}` instead of throwing). Fixed by making all four
find-or-create, resetting the advisory deal's mutable fields to their original seed values every
run, and rewriting its audit/stage_events assertions as before/after deltas rather than absolute
counts - that history correctly accumulates across real runs (CLAUDE.md #4), it doesn't reset. See
`db/migrations/README.md` for the same note.

Verified: typecheck, lint, unit (150 tests), RLS (112 tests across all seven files, including the 13
new to this milestone) all green; `test:integration` run three times consecutively against the real
hosted project, all 29 tests green every time, including `changeStage`'s `updated_at`/`updated_by`
and `stage_events` assertions (from/to stage, actor, `is_regression`, and
`duration_in_previous_seconds` checked against an independently recomputed expected value, not a
hardcoded one) - and the full Playwright e2e suite (11 tests) green, confirming no regression
anywhere else.

**M2.3** (`days-in-current-stage`) is scoped narrower than the backlog line reads, deliberately:
"Days-in-current-stage derived from the latest event; staleness colour on board and table" reads as
one deliverable, but `docs/04-metric-definitions.md`'s own "Staleness bands" definition ties that
colour strictly to `deals.last_engaged_at` (an M3 concept - nothing populates that column until the
activities entity exists). Implementing a colour band against a column that's null for every deal
today would repeat the exact premature-feature mistake M1.4's own filter set already avoided once,
so this milestone ships days-in-current-stage only; staleness colour is deferred to M3.7, where the
docs already define it correctly against real data.

This is also the first real use of `tenants.timezone`/`users.timezone` in this codebase (CLAUDE.md
#8: "Timestamps stored in UTC, rendered in the user's timezone. Default tenant timezone is
Africa/Lagos"). New `src/lib/dates.ts` provides `resolveTimezone` (a user's own override wins over
their tenant's default) and `daysBetweenInTimezone` - whole calendar days between two instants,
each resolved to its calendar date **in the given timezone first**, never a raw UTC millisecond
difference divided by 86400 - the exact bug class CLAUDE.md #8 exists to prevent (an instant at
23:30 WAT is already the next calendar day locally even though it isn't in UTC).
`tests/unit/dates.spec.ts` proves this against three separate cases, not just the happy path: a
30-minute span that crosses a day boundary in `Africa/Lagos` (WAT, UTC+1) but not in UTC - the exact
scenario `docs/07-build-backlog.md`'s M3.9 names ("an activity logged at 23:30 WAT renders the
correct local date"); the mirror-image case in a negative-offset zone (`America/Los_Angeles`) to
prove the fix isn't coincidentally only correct for positive offsets; and a negative-span clamp (a
`since` later than `until` renders `0`, never a nonsensical negative day count).

`src/services/actor.ts`'s `ActorResult` now carries a single resolved `timezone` string (fetched
alongside role grants and tenant name), so every future date-rendering call site has one place to
get it right rather than re-deriving the override/fallback logic itself.
`src/data/stageEvents.ts`'s new `getLatestStageEventOccurredAtByDeal` and `src/data/deals.ts`'s
`listDeals` (now `listDeals(supabase, filters, timezone, now?)`) combine to compute
`daysInCurrentStage` per row: the latest `stage_events.occurred_at` for that deal, or
`deals.created_at` if it has never had a transition (`createDeal` deliberately writes no
`stage_events` row - creation isn't a transition per `docs/01-domain-model.md`'s list of transition
paths). Surfaced on both the pipeline table (a new "Days in stage" column) and the board card.

Verified: typecheck, lint, unit (159 tests, 9 new for `src/lib/dates.ts` including the WAT/UTC
boundary cases above), RLS (112 tests, unchanged - no new RLS surface), `test:integration` (31
tests, 2 new, against the real hosted project, independently recomputing the expected
`daysInCurrentStage` from the deal's real `created_at`/latest `stage_events` row rather than
hardcoding a value that would only hold on a fresh fixture), and the full Playwright e2e suite (11
tests, unchanged - the seeded demo tenant this suite runs against has zero deals, so the new column
never actually renders there; a populated view was verified manually against the real
`m1-4-integration-test` fixture tenant instead, screenshotted for both table and board).

**M2.4** adds a **stage-history panel** to the deal detail page - narrower than
`docs/06-ui-spec.md`'s full "Engagement timeline" (which merges activities and stage events, M3.5,
blocked on activities existing): a `stage_events`-only precursor, newest first, showing each
transition's from/to stage, actor, date and duration in the previous stage, with a "Regression"
badge where `is_regression` is true. This is M2's exit criterion made visible - "duration and
regression are queryable" now has somewhere to actually look.

`src/data/stageEvents.ts`'s new `listStageEventsForDeal` reads through the caller's own RLS-scoped
session (`stage_events_select`, migration 0007) - the same "no separate `can()` check for viewing"
reasoning `getDealDetail` already established for `deal.view`, since there's no distinct permission
action for reading stage history either. Disambiguates the two `pipeline_stages` embeds (`from_stage`/
`to_stage`) and the `users` embed (`actor`) the same way `owner:users!owner_id` already does
elsewhere - `from_stage_id`/`to_stage_id` both reference the same table, so PostgREST needs the
explicit `!column` hint or the join is ambiguous.

Two new `src/lib/dates.ts` helpers, both used for the first time here: `formatDateInTimezone`
(DD/MM/YYYY, CLAUDE.md #8's default, resolved in the viewer's timezone - not `tenants.date_format`/
`users.date_format`; no document in this repo specifies what alternate format strings those columns
may hold, so implementing an override would be inventing a business rule rather than following one -
flagged, not guessed, and not yet worth blocking on since every caller today only needs the
documented default) and `formatDurationSeconds` (a plain unit-scaled rendering of a duration in
seconds - presentational, not a new analytic metric formula).

Verified: typecheck, lint, unit (165 tests, 6 new for the two formatting helpers), RLS (112,
unchanged), `test:integration` (34 tests, 3 new: real newest-first ordering and resolved names
against the advisory deal's actual accumulated history, RLS exclusion for an out-of-practice bde,
and an empty result - not an error - for a deal with no transitions yet), the full e2e suite (11,
unchanged, same seeded-tenant-has-zero-deals limitation as M2.3), and a manual browser check against
the real `m1-4-integration-test` fixture tenant confirming the rendered panel: correct DD/MM/YYYY
dates, human-readable durations ("6 minutes", "under a minute"), and no false "Regression" badges
on what is, in this fixture, an unbroken run of forward transitions.

## M3 — Engagement timeline ⚑ (the reason the product exists)

**M3.1** (`activities`, `activity_revisions` migrations) is implemented and verified, both locally
and against the real hosted project.

Two deliberate deviations from the backlog line's literal wording, called out rather than silently
worked around or silently followed:

1. The backlog also names a third table, `activity_contacts` - but its `contact_id` references
   `contacts(id)`, and `contacts` doesn't exist in this codebase until M5.5. A table cannot
   reference a table that isn't there. `activity_contacts` is deferred to M5.7 ("Activity
   attribution to contacts") - the same deliverable, scheduled for when its dependency is real, not
   invented around with a placeholder FK.
2. The `last_engaged_at`/`engagement_count`-maintaining trigger `db/schema.sql` itself bundles into
   the activities section is deliberately **not** built here - `docs/07-build-backlog.md` splits
   that out explicitly as M3.2's job ("`logActivity` service: the single creation path, deriving
   `last_engaged_at`, `engagement_count`... in one transaction"). This migration is the table
   structure only.

New enums `activity_type`/`activity_source`/`disposition`, matching `db/schema.sql` exactly.
`is_client_facing` is a genuine Postgres `generated` column this time (unlike `stage_events`'s
`is_regression` in M2.1) - it only ever compares the same row's own `type` column, so no trigger
workaround is needed. A `before insert` trigger captures `stage_id_at_time` from the deal's current
stage, authoritative regardless of what a caller passes - the same trigger-is-authoritative pattern
migrations 0006/0007 already established for `updated_at`/`duration_in_previous_seconds`.

RLS mirrors `deals_select`/`deals_update`'s scope shape via migration 0005's existing
`deal_practice_line_id()`/`deal_owner_id()`/`deal_author_id()`/`is_deal_co_owner()` helpers - no new
helper functions needed, and (verified directly, not merely reasoned about) no RLS recursion between
`activities` and `activity_revisions` despite the latter's `select` policy joining into the former,
since only one direction of that relationship needs the other table's data.

The one genuinely interesting scope shape: `activity.update` is uniformly "the author only, within
24 hours" for **every** role, including `tenant_admin` - unlike `deals`, no role may edit someone
else's activity at all. Correcting another author's entry is `activity.retract`
(`docs/02-permission-matrix.md`: director/tenant_admin only, no time limit) - a materially broader
permission this migration's `activities_update` policy deliberately does not grant. Flagged as a
known, anticipated gap for M3.6 to close: the same "RLS is coarse, the fine-grained rule lives in a
dedicated service path" reasoning `tests/rls/deals_permission_matrix.spec.ts` already documents for
`deal.change_owner` applies here - `retractActivity` will need its own service-role-backed write
path, not an extension of this `USING` clause.

`activity_date_not_future`'s `check (activity_date <= current_date)` is deliberately left as a
coarse, defense-in-depth backstop, not the precise rule: Postgres's `current_date` is evaluated in
the database's own session timezone (UTC), not the acting user's, the exact class of imprecision
CLAUDE.md #8 exists to prevent (a WAT user's "today" can already be one calendar day ahead of
UTC's). The precise, timezone-aware check - using the actor's own resolved timezone via
`src/lib/dates.ts`, the same infrastructure M2.3/M2.4 built - is `logActivity`'s job (M3.2), the
same "RLS is a second, independent control, never the only one" layering CLAUDE.md #1 already
establishes for authorisation, generalised here to date validation.

No application code changes yet - `src/auth/permissions.ts`'s `activity.*` entries (including the
named regression test, "a user holding only the bde role can create an activity on a deal they
own") were already built in M0.4, ahead of the table existing, and needed no changes.

New `tests/rls/activities.spec.ts` (28 tests) covers: `stage_id_at_time` capture (including that
the trigger overrides a deliberately-wrong caller-supplied value), `is_client_facing` for every one
of the eight activity types, the `activity_date_not_future`/empty-summary/`retraction_needs_reason`
constraints, `activities_select`'s practice/tenant scope (including D-06's executive full-narrative
read), `activities_insert`'s scope for every role (including the RLS-level version of the named
regression guard), `activities_update`'s author-only-within-24h shape (including that even
`tenant_admin` cannot edit someone else's entry, and that the window genuinely closes), and
`activity_revisions`' immutability/read-scope/no-insert-policy shape.

Verified: migration tested forward and backward against local Postgres, then applied to the real
hosted project via the Supabase Management API (`schema_migrations` there now lists `0001` through
`0008`) - see `db/migrations/README.md`. Typecheck, lint, unit (165, unchanged - no application code
touched this milestone), RLS (140 tests total, the 28 new above alongside every existing suite), and
the full Playwright e2e suite (11, unchanged) all green.

**M3.2** adds `logActivity` (`src/services/activities.ts`) - the single path for creating an
activity, mirroring `changeStage`/`createDeal`'s established shape exactly: `not_found` before
`denied` (RLS already hid the row from an actor outside their scope, so this never confirms
existence to them), `can()` checked here even though `activities_insert` (migration 0008) enforces
the same scope independently.

Migration `0009_activity_engagement_trigger` adds the `last_engaged_at`/`last_engaged_activity_id`/
`engagement_count` derived-field trigger - deliberately left out of migration 0008 (M3.1), since the
backlog itself names this as M3.2's deliverable ("deriving `last_engaged_at`, `engagement_count`...
in one transaction"). A trigger, not application code, is what actually makes "in one transaction"
true here, the same reasoning migrations 0006/0007 already established: a Supabase-client caller has
no multi-statement transaction available to it, but a single `INSERT` firing an `AFTER INSERT`
trigger genuinely is one. `last_engaged_at` uses only client-facing, non-retracted activities;
`engagement_count` counts every non-retracted activity regardless of type - two adjacent rows in
`docs/01-domain-model.md`'s derived-values table with different filters, easy to conflate, so both
are tested independently (including that an older client-facing activity never moves
`last_engaged_at` backwards, and that retracting the most-recent one correctly recomputes to the
next-most-recent).

The one genuinely new business-logic piece: migration 0008's `activity_date_not_future` check is
only a coarse UTC backstop (its own comment says so) - `logActivity` is where the PRECISE,
timezone-aware future-date rejection actually happens, using the actor's own resolved timezone via
`src/lib/dates.ts`'s new `dateInTimezone` export (added alongside the existing `daysBetweenInTimezone`/
`formatDateInTimezone`, all sharing the same underlying calendar-date-in-timezone logic).

One small refactor along the way: `src/data/deals.ts`'s `getDealForStageChange` (built for
`changeStage`, M1.5) turned out to be exactly the shape `logActivity` also needs for its own `can()`
check - generalised to `getDealForAuthorization` rather than duplicated under a second name, since a
second caller needing an identical shape is a real pattern worth naming honestly. Its one caller
(`changeStage`) was updated accordingly; nothing about its behaviour changed.

Also promoted: `tests/integration/pipeline-list.spec.ts`'s `findOrCreateByUniqueMatch` helper (the
M2.1 fixture fix) moved into `tests/integration/support/permanentFixture.ts` once a second
integration spec (`tests/integration/log-activity.spec.ts`) needed the identical logic -
`logActivity` writes to `activities`, which has its own FK to `deals`, so once an activity exists
for a deal, that deal joins the permanently-un-deletable list the same way `stage_events` already
put it there; a fresh delete-and-recreate fixture would have silently broken the same way M2.1's
did.

Verified: migration 0009 tested forward/backward locally, then applied to the real hosted project
(`schema_migrations` there now lists `0001` through `0009`). New `tests/rls/activity_engagement_trigger.spec.ts`
(6 tests) proves the trigger's arithmetic directly against local Postgres. New
`tests/integration/log-activity.spec.ts` (5 tests) exercises `logActivity` end to end against the
real hosted project - a client-facing activity advancing `last_engaged_at`/`engagement_count` with
one audit row, an internal activity that's logged but doesn't advance `last_engaged_at`, RLS-scoped
`not_found`/`denied` cases, and the timezone-aware future-date rejection - run twice consecutively
to confirm idempotency. Typecheck, lint, unit (167, 2 new for `dateInTimezone`), RLS (146 total, the
6 new above), integration (39 total across all four real-project spec files), and the full Playwright
e2e suite (11, unchanged) all green.

**M3.3** ⚑ (RLS policy for activity insert, with the named test "a user holding only the bde role
can create an activity on a deal they own") is test-only, closing out the migration side of this
milestone - `docs/02-permission-matrix.md`'s `activity.*` scope was already fully implemented in
`src/auth/permissions.ts` since M0.4, and `activities_insert` (migration 0008) already enforced the
same shape independently, so no application or migration code changed here. New
`tests/rls/activities_permission_matrix.spec.ts` is the exhaustive per-role x per-resource-shape
matrix mirroring `tests/rls/deals_permission_matrix.spec.ts`'s own structure exactly - the same
M1.1-to-M1.8 relationship applied to activities, `tests/rls/activities.spec.ts` (M3.1) having
already covered the foundational scope and named cases.

The one shape worth calling out, proven rather than assumed: `activities_select` mirrors
`deals_select` (practice-wide **read** for every scoped role), but `activities_insert` mirrors
`deals_UPDATE`, not `deals_select` - a `bde` may read every activity in their practice but may only
*create* one on a deal they own/co-own/authored. `bdeA2` (a practice colleague, not the deal's
owner) is a clean per-column example of this: `true` for select, `false` for insert, in the same
test run against the same fixture deal. The exact named regression string from the backlog appears
verbatim as its own test, at the RLS level - `tests/permissions/matrix.spec.ts` already proves the
application-layer half.

Verified: typecheck, lint, unit (167, unchanged - no application code touched), RLS (160 tests
total, the 14 new above alongside every existing suite, including the exact named regression
string). Integration and e2e suites are unaffected (no application, service, data, or migration
code changed this task) and were not re-run beyond the previous task's already-green results.

**M3.4** adds the **Log Activity modal** - the first real UI this milestone, meeting
`docs/06-ui-spec.md`'s "three-interaction constraint" literally: click Log Activity (opens the
modal, autofocuses Summary, Type/Activity date already defaulted), type the summary, Ctrl+Enter
saves. Fields in the spec's own order - Type as a segmented control (not a dropdown), Activity date
(defaults to today **in the actor's own resolved timezone**, future dates disabled inline with the
spec's exact copy, "future intent is a task, not an engagement"), Summary (the only mandatory
field), then a collapsed-by-default Outcome/Disposition section.

Two fields the spec names are deliberately not built: "contacts present" and "attachments" (`M5.5`/
`M3.8`, neither exists yet), and the secondary "Save and add task" button (`M4`'s Add Task modal
doesn't exist yet). Building any of these now would be a control with nothing real behind it - the
same reasoning every narrower-than-spec vertical slice this session has taken.

One UX detail the docs don't specify and this component had to decide: the keyboard shortcut key.
"L" (mnemonic for "Log") is this component's own choice, flagged in its own comment rather than
presented as if the spec named it. It only fires when the modal is closed and focus isn't already
in a text input, so it never hijacks normal typing elsewhere on the page.

New `src/services/activities.ts`'s `canLogActivity` mirrors `getDealForEditView`'s shape (a separate
fetch from `getDealDetail`, whose fields are display-oriented names, not the raw ids a `can()`
check needs) - it's what the page uses to decide whether to render the button at all
(`docs/06-ui-spec.md`: "visible to every writing role including BDE" - not executive).

Manual browser QA (this container's Playwright has no service-role credentials to seed a populated
deal, the same limitation already documented for M1.6/M1.7/M2.3/M2.4) against a real fixture tenant
confirmed: the button opens the modal with Summary autofocused; Ctrl+Enter and the "L" shortcut both
work; a future date disables Save with the exact inline copy; an executive never sees the button at
all; and the logged activities persisted correctly for real, verified directly against the database
(`is_client_facing` correct per type, `last_engaged_at`/`engagement_count` updated via migration
0009's trigger). That QA pass surfaced one real, pre-existing gap in
`tests/integration/log-activity.spec.ts`'s own fixture (not new to M3.4): it never inserted an
`account_practice_owners` row, so `getDealDetail`'s `accounts(...)` embed silently came back null
for a bde on the actual deal detail page - invisible to that spec's own tests, which only call
`logActivity` directly and never render the page. Fixed in the fixture, not worked around.

Also worth recording: this QA pass surfaced several stale `next-server` processes left running in
this container from earlier manual-QA sessions in this same conversation (`pkill` had not reliably
terminated them). Multiple builds bound to the same port simultaneously produced exactly the kind of
intermittent "client-side exception" hydration mismatch a real code defect would - two consecutive
full e2e suite runs failed at different, unrelated tests each time. Diagnosed by `pgrep`-listing
every `next-server` process, force-killing all of them, and confirming the e2e suite passes
consistently on a clean server - a process-hygiene artifact of this session, not a regression, but
recorded here since it looked exactly like one until traced down.

Verified: typecheck, lint, unit (167, unchanged), RLS (160, unchanged), integration (39 total, the
fixture fix above), and the full Playwright e2e suite (11) all green - confirmed clean after
resolving the stale-server artifact.

**M3.5** adds the **Engagement timeline** - merging activities (M3.1/M3.2) and stage events
(M2.1/M2.2) into one newest-first stream, with type and author filters and a designed empty state
("No engagement logged yet - log the first conversation," with Log Activity inline, the same
"action lives where the empty state names it" pattern the pipeline's own "No deals to show yet"
empty state already established). This **supersedes** M2.4's narrower stage-history-only panel
rather than sitting alongside it - the merged view was always described as that panel's
successor.

Three deliberate omissions from `docs/06-ui-spec.md`'s fuller description, each because its
dependency doesn't exist yet: no "attributed contacts" (`M5.5`), no "edited" marker or revision
history (`M3.6` - activity edits have existed since M3.1's `activity_date_not_future`/24h-window
design, but nothing surfaces them yet), and retracted entries aren't rendered struck-through (`M3.6`
again - no code path sets `retracted_at`, so that would be speculative UI for a state nothing can
produce). "Type icon" is a text label, not a graphic - no icon system exists in this codebase.

The one real design problem this task had to solve: sorting an activity (`activity_date`, a plain
`DATE` with no time-of-day) against a stage change (`occurred_at`, a full `TIMESTAMPTZ`) needs a
common instant. `src/services/engagementTimeline.ts`'s `getEngagementTimeline` treats an activity's
sort key as noon UTC on its `activity_date` - a pure ordering heuristic, never returned or
displayed; each entry still carries its own real, distinct date/time field untouched. This is
deliberately **not** a CLAUDE.md #5 violation ("`activity_date` and `created_at` are different
things, never conflated in any query, export or API response") - that invariant is about values a
caller can observe, and this sort key is neither returned nor exported, only used internally to
interleave two arrays before returning each entry's own honest fields.

Also new: `formatPlainDate` (`src/lib/dates.ts`) - `activity_date` has no timezone to resolve at
all, so formatting it via `formatDateInTimezone`/`Date`/`Intl` would risk exactly the off-by-one-day
bug this file's other functions exist to prevent, if a caller ever mis-supplied a timezone. Plain
string manipulation (`YYYY-MM-DD` → `DD/MM/YYYY`) has no such risk. `ACTIVITY_TYPE_LABELS`/
`OUTCOME_DISPOSITION_LABELS` were promoted from `LogActivityModal.tsx` (M3.4) into
`src/domain/activity.ts` once this task's filter dropdown and timeline entries needed the identical
labels - the same "second caller needing identical logic gets promoted" pattern M3.2 already used
twice.

New `tests/integration/pipeline-list.spec.ts`'s `getEngagementTimeline` describe block logs two
real activities onto the same real, permanently-accumulating advisory deal fixture and proves the
merge against its already-real stage_events history: both new activities and at least one stage
change appear; the whole merged set is newest-first by each entry's own real field; the `type`
filter isolates `stage_change` and a specific activity type correctly; the `author` filter matches
both an activity's author and a stage change's actor by the same person; and an out-of-practice bde
sees an empty timeline. Manual browser QA against the real `m1-4-integration-test` fixture (with a
real accumulated history of stage changes and freshly-logged activities) confirmed the rendered
page: correctly interleaved entries, working type/author filters via URL search params, and no
console or page errors.

Verified: typecheck, lint, unit (169, 2 new for `formatPlainDate`), RLS (160, unchanged - no new RLS
surface), integration (41 total, 2 new, against the real hosted project, run twice consecutively),
and the full Playwright e2e suite (11, unchanged) all green.

**M3.6** closes the two gaps M3.5 named as its own: edit within the 24-hour window with revision
history and an "edited" marker, plus retraction by Director or Admin with a mandatory reason,
rendered struck through. **No new migration or RLS policy is needed** - migration 0008 (M3.1)
already shipped `activities_update` (author-only, within `edit_locked_at`), the
`retraction_needs_reason` check constraint, and `activity_revisions` with no `insert` policy for
`authenticated` at all, precisely so this milestone could be pure service/UI work on top of an
already-correct data layer.

`src/services/activities.ts` adds two functions alongside `logActivity`/`canLogActivity`:

- `updateActivity` - reuses `activities_update` via the **caller's own** RLS-scoped session (the
  same "RLS is a second, independent control" reasoning every other write in this codebase follows).
  Diffs the five editable fields, writes one `activity_revisions` row per **changed** field (not one
  combined blob - that per-field ledger is the whole reason the table exists, distinct from and
  written alongside the audit trail CLAUDE.md #6 requires regardless), and returns a specific result
  code (`not_found` / `denied` / `retracted` / `edit_window_expired`) rather than treating a
  zero-row RLS-filtered `UPDATE` as a silent no-op - a caller needs to know *why* nothing happened,
  the same reasoning `logActivity`'s `activity_date_in_future` is a distinct code rather than a
  generic denial.
- `retractActivity` - `docs/02-permission-matrix.md`'s `activity.retract` is scoped by the
  underlying **deal's** practice/tenant, not authorship (a director corrects any practice member's
  entry, unlike the author-only edit window), so this is the service-role-backed write migration
  0008's own comment flagged as this milestone's job to close, authorised solely by an explicit
  `can()` check before the privileged write happens - the same shape `changeStage`/`writeAudit`
  already use for privileged single-path writes, not an extension of `activities_update`'s policy.

`src/data/activityRevisions.ts` is new: `insertActivityRevisions` (service-role, one row per
changed field) and `listActivityRevisionsForActivities` (batched across every activity in a deal's
timeline in one call, the same batch-not-per-row reasoning `getLatestStageEventOccurredAtByDeal`
already established). `src/services/engagementTimeline.ts`'s `ActivityTimelineEntry` now carries
`editLockedAt`/`retractedAt`/`retractedByName`/`retractionReason`/`revisions` so the timeline can
decide, per entry, whether to show Edit/Retract/the edited marker without a second round trip -
closing the exact two omissions M3.5's own section named.

UI: `EditActivityModal.tsx` and `RetractActivityModal.tsx` mirror `LogActivityModal.tsx`'s shape
(native `<dialog>`, plain-arguments server action) - the deal detail page renders Edit only for an
entry the current actor authored, that isn't retracted, and whose window hasn't closed; Retract only
when `canRetractActivity` (a new deal-level, not per-entry, helper - retraction eligibility depends
only on role and the deal's practice/tenant, identical for every activity on it, unlike
authorship-based Edit) is true and the entry isn't already retracted. Retracted entries render
struck through with the retractor's name and reason; edited entries show an "edited" marker with an
expandable revision history (field, previous → new value, who, when).

One real bug found via manual browser QA against a fixture with many logged activities, fixed
before this shipped: `LogActivityModal`/`EditActivityModal`/`RetractActivityModal` each used a
**static** form-field `id` (`"summary"`, `"edit-summary"`, `"retract-reason"`, etc). With more than
one instance mounted at once - every `EditActivityModal`/`RetractActivityModal` on the timeline
renders simultaneously, one per eligible entry, and `LogActivityModal` itself already double-mounts
when the timeline is empty (header button + empty-state button) - that's a duplicate `id` on the
page: invalid HTML and unreliable `label`/`htmlFor` association. Fixed by giving each instance its
own `useId()`-derived prefix; verified after the fix that a fixture with 32 activities renders zero
duplicate `id`s.

New `tests/integration/edit-retract-activity.spec.ts` (11 tests) exercises the real chain against
the real hosted project: the author edits within the window (one revision row per changed field,
one audit row); editing with no actual changes writes neither; a practice peer (even a director) who
didn't author the entry is denied editing it - update is author-only, never practice-scoped, even
for the role that *can* retract; the window closing is `edit_window_expired`, not a silent no-op; a
retracted activity can't be edited even by its own author inside the window; a director retracts a
practice member's activity (`retracted_at`/`retracted_by`/`retraction_reason` set, one audit row);
the author themself cannot self-retract; a director outside the deal's practice line can't even see
the activity to retract it (`not_found`, the same RLS-hides-it-first reasoning every other
cross-practice case in this codebase already uses); a blank reason is rejected before any write; and
an already-retracted activity can't be retracted twice. Run three times consecutively against the
real project to confirm fixture idempotency. `tests/permissions/matrix.spec.ts` also gained five
named cases for `activity.update`/`activity.retract` (positive and negative, every role) - the
CLAUDE.md permission-test rule applied to two actions that existed in the matrix since M3.1/M3.3 but
had no dedicated behavioural test until the feature that actually exercises them shipped.

Verified: typecheck, lint, unit (174, 6 new), RLS (160, unchanged - migration 0008's own RLS suite
already covered `activities_update`/`activity_revisions` exhaustively at the DB level since M3.1),
integration (52 total, 11 new, against the real hosted project, run three times consecutively), and
the full Playwright e2e suite (11, unchanged) all green. Manual browser QA as the author (bde) and
as a director against a real fixture confirmed: correct pre-filled Edit modal, successful save with
the "edited" marker and expandable revision history appearing, correct Retract-only-for-director
visibility, successful retraction rendering struck through with reason and retractor name, and (post
`useId` fix) zero duplicate DOM ids on a timeline with 32 real entries.

**M3.7** adds the last-engaged chip on the deal header; a last-engaged column, sort and "days since
last engagement" filter on the pipeline table/board; and staleness colour wherever a deal is
rendered. **One scope deviation, flagged rather than silently built or silently dropped**: the
backlog line also says "staleness bands wired to the at-risk tile," but no at-risk tile exists
anywhere in this codebase or in `docs/06-ui-spec.md` - the Dashboard screen (`app/(app)/dashboard/`)
is a deliberate stub ("This screen lands with the analytics milestones later in the backlog"), and
role-scoped dashboards are `docs/07-build-backlog.md` **M6.8**, nine milestones away. Building a
tile against a screen that doesn't exist yet, on top of a spec that doesn't describe it, would
repeat the exact premature-feature mistake this codebase has deliberately avoided every time before
(M1.4's filter set, M2.3's staleness-colour deferral, M3.5's three omissions) - so this part is
deferred to M6.8, where the Dashboard itself gets built, not fixed here.

`docs/04-metric-definitions.md`'s "Staleness bands" (0-7 green, 8-21 blue, 22-45 amber, 46+ red) and
"null last-engaged means never engaged... not treated as zero" are now real code:
`src/domain/deal.ts`'s new `stalenessBand`/`formatLastEngaged` treat "never" as a genuine fifth
state, not folded into the 46+ band, matching the doc's own wording. `src/lib/dates.ts` gained two
plain-DATE helpers (`daysSincePlainDate`, `subtractDaysFromPlainDate`) - deliberately **not** built
on the TIMESTAMPTZ-oriented `daysBetweenInTimezone`, for the exact off-by-one-day reason
`formatPlainDate`'s own comment already gives: `deals.last_engaged_at` is a bare `date` column, the
same shape as `activities.activity_date`, with no time-of-day or timezone to resolve.

`src/data/deals.ts`'s `listDeals` and `getDealDetail` now select `last_engaged_at` and compute
`daysSinceLastEngagement`; `DealListFilters` gained `minDaysSinceEngagement` (a never-engaged deal
always matches - it's at least as stale as any threshold, the same reasoning as the "never" band)
and the app's **first sort control**, `sortBy`/`sortDir` on `last_engaged_at` (ascending =
most-stale-first, including nulls; descending = most-recently-engaged-first). `getDealDetail` gained
required `timezone`/`now` parameters for the same plain-DATE-vs-"today" reasoning `listDeals` already
established - every call site (the deal detail page, five integration tests) was updated accordingly.

UI: `PipelineTable.tsx`'s new "Last engaged" column is a sortable link
(`src/lib/pipelineViewLinks.ts`'s new `lastEngagedSortHref`, mirroring `viewToggleHref`'s
param-preserving shape) coloured by staleness band; `PipelineBoard.tsx`'s cards get the same band as
a coloured left edge (`docs/06-ui-spec.md`: "staleness colour on the board card's left edge") plus
the same "Last engaged N days ago" text; `PipelineFilters.tsx` gained a plain numeric "Days since
last engagement" input, and carries the sort as hidden fields so submitting the filter form doesn't
silently drop it (the same reason it already carries `view`). The deal header
(`app/(app)/deals/[id]/page.tsx`) gained the last-engaged chip docs/06-ui-spec.md's exact wording
calls for: `"Last engaged 12 days ago"` in the staleness colour, or `"Never engaged"` in red.

New `tests/integration/pipeline-list.spec.ts` describe block (6 tests, run after the
`getEngagementTimeline` block so `advisoryDealId` already has a real, non-null `last_engaged_at`
from its own real activity history, while `searchDealId` has never had one logged - the fixture's
permanent "never engaged" case): `listPipelineDeals` and `getDealDetail` agree on the real computed
`daysSinceLastEngagement`; the never-engaged deal's fields are `null`, not zero; the minimum-days
filter includes a never-engaged deal but excludes one engaged today; a zero-day filter includes
both; and both sort directions order the two real deals correctly. Manual browser QA (executive:
table and board views, the sort link toggling both directions, the days-since-engagement filter
excluding the freshly-engaged deal; bde: the header chip) confirmed correct rendering and no console
errors against the real `m1-4-integration-test` fixture - note for future QA against this fixture:
its `user_roles`/`account_practice_owners`/`deal_co_owners` rows are wiped by this spec file's own
`afterAll` cleanup, so they need reseeding before browser QA if the integration suite ran most
recently (the same gap `tests/integration/log-activity.spec.ts`'s own comment already documents).

Verified: typecheck, lint, unit (197, 23 new), RLS (160, unchanged - no new RLS surface, only new
fields read under the existing `deals_select` scope), integration (58 total, 6 new, against the real
hosted project, run twice consecutively), and the full Playwright e2e suite (11, unchanged) all
green.

**M3.8** adds attachments on activities, inheriting deal visibility - upload from the Log Activity
modal, view/download from the Engagement timeline.

**Stopped and asked before implementing**, per CLAUDE.md's own instruction: file storage is a brand
new architectural surface (Supabase Storage, RLS-equivalent access, signed URLs) with zero decisions
recorded anywhere in `docs/DECISIONS.md` or `docs/03-architecture.md` - no max file size, no allowed
file types, no virus-scanning stance. Asked the product owner three questions; none were answered
before "continue," so the recommended defaults were used, explicitly flagged rather than silently
assumed: **10 MB** max size; **common office + PDF + image** MIME allow-list (pdf, doc/docx,
xls/xlsx, ppt/pptx, png, jpg); **no virus/malware scanning** - this environment has no scanning
service configured or credentials for one, a disclosed gap for a future security-hardening
milestone, not a silent omission (`src/domain/document.ts`, `src/services/documents.ts`).

`db/migrations/0010_documents.up.sql` adds `documents` (`docs/01-domain-model.md`'s own field list)
with two deliberate, disclosed deviations: `contact_id` is deferred (references `contacts(id)`,
which doesn't exist until M5.5 - the identical "can't reference a table that isn't there" reasoning
migration 0008 already gave for `activity_contacts`), and `version_number`/`supersedes_document_id`
are deferred to **M9.5** ("Documents with versioning and deal linkage"), a materially later
milestone than this one. `account_id` IS included (nullable, unused by any code path yet) since,
unlike `contact_id`, `accounts` already exists - mirroring `activities.account_id`'s own "documented
column, no code path yet" precedent. `practice_line_id` is a genuine, physical column here (unlike
`activities`, which derives it via `deal_practice_line_id()` and stores no such column) - the one
real difference between the two tables' own field lists in `docs/01-domain-model.md`, most plausibly
because a future practice-scoped document (an M9.5 template) may have no deal/account/activity at
all; captured on insert from `deal_id` by a trigger, the same trigger-is-authoritative pattern
`stage_id_at_time` already established.

Supabase Storage buckets are plain rows in `storage.buckets` (documented Supabase behaviour), so the
private "documents" bucket is provisioned by this same migration (`insert into storage.buckets`),
alongside the schema it supports. **Deliberately no RLS policy on `storage.objects` at all**: every
read/write goes through the caller's own RLS-scoped read of the `documents` table first (the real
authorisation boundary), then a service-role client for the actual Storage call
(`src/lib/storage.ts`) - the same privileged-single-path-write shape `writeAudit`/`writeStageEvent`/
`retractActivityRow` already use. Duplicating the identical check a second way as `storage.objects`
RLS would be two sources of truth for one rule, not CLAUDE.md #1's RLS-plus-`can()` pairing (which
checks the same resource by two *independent* mechanisms).

**A genuine RLS mechanics discovery**, worth recording so it isn't rediscovered the hard way:
Postgres re-validates an `UPDATE`'s resulting row against a table's *SELECT* policy too, not only
the `UPDATE` policy's own `USING`/`WITH CHECK` (verified directly, not merely reasoned about). Since
`documents_select` requires `deleted_at is null`, a caller's own RLS-scoped session can never
successfully set `deleted_at` through a plain `UPDATE` policy - the very act of soft-deleting makes
the resulting row fail the policy that gates the update. `document.soft_delete`
(`docs/02-permission-matrix.md`) is therefore **not built in M3.8 at all** - both because removal
isn't what this milestone's own backlog line asks for (upload plus view, not deletion) and because a
real implementation needs a service-role-backed write, `retractActivityRow`-style, not an RLS
policy. `deleted_at` stays as a column for that future work, the same "documented shape, no code
path yet" precedent as `account_id` above.

Local Postgres has no `storage` schema at all (that's Supabase-specific), so
`tests/rls/fixtures/local_auth_shim.sql` gained a minimal `storage.buckets` shim - just the one
table migration 0010's bucket-provisioning insert touches - the same "just enough of Supabase's own
schema to exercise our policies locally" reasoning the existing `auth.uid()` shim already
established. Separately, verified directly against the real hosted project: Supabase blocks a
direct SQL `DELETE` against storage tables ("Use the Storage API instead" -
`storage.protect_delete()`), so `0010_documents.down.sql` deliberately does not attempt to delete
the bucket row - rolling back leaves an empty, harmless, unused bucket in place.

`src/services/documents.ts`'s `attachDocumentToActivity` mirrors `logActivity`'s shape exactly
(not_found before denied, `can()` checked here even though `documents_insert` enforces the same
scope independently) - `activity.attach_file`'s "own" is the underlying **deal's** ownership fields,
the identical definition `activity.create` already uses, not the specific activity's own author.
Upload to Storage happens *before* the `documents` row insert - the safer of the two orderings this
architecture allows (no single transaction spans both): a failed insert after a successful upload
leaves a harmless orphaned Storage object, never a `documents` row promising a file that was never
written. `getDocumentDownloadUrl`'s entire authorisation check IS `getDocumentForDownload`'s read
through the caller's own RLS-scoped session ("inheriting deal visibility") - minting the signed URL
afterwards is a mechanism, not a second decision.

UI: the Log Activity modal's optional-fields section (M3.4) gained a plain multi-file input -
`docs/06-ui-spec.md`'s own field list already named "attachments" as one of the collapsed-by-default
optional fields, alongside outcome/disposition/contacts-present. Files are passed to the server
action as a plain `File[]` argument (Next.js Server Actions serialise `File` directly, the same as
any other supported argument type) - no `FormData`, keeping the established plain-arguments shape.
A failed attachment (too large, wrong type) never fails the whole action: the activity always saves
independently, and any per-file problem comes back as a warning on an otherwise-successful result,
surfaced inline rather than silently dropped. The Engagement timeline (M3.5/M3.6) gained a per-entry
attachment list with a download control (`AttachmentLink.tsx`) that calls a server action for a
fresh, short-lived (5 minute) signed URL before ever opening anything - never a plain link straight
to Storage.

**One real bug found via manual browser QA, fixed before this shipped**: `AttachmentLink`
originally called `window.open()` *after* awaiting the server action's result. Real browsers treat
that async gap as breaking the "this was still directly caused by the user's click" heuristic and
silently popup-block it - it worked, but produced no visible tab. Fixed with the standard pattern:
open a blank tab *synchronously*, inside the click handler, then redirect it once the signed URL
resolves (`tab.opener = null` set from the opener's side to keep the same protection `noopener`
would give, since passing `noopener` to `window.open()` would return `null` and forfeit the very
reference this fix needs). Verified the fix three independent ways rather than relying on a
Playwright popup assertion in this sandbox, which turned out to have no route to *any* external
host at all (even the Supabase project's own root URL times out from the headless browser here,
confirmed directly) - a sandbox network limitation, not an app defect: (1) the real integration
test fetches the actual signed URL directly and gets back exact file content; (2) a raw
`window.open` + redirect probe, independent of this component, demonstrably attempts real
navigation; (3) the server action returns `ok` with no client-side errors when clicked in the
running app.

New `tests/integration/attach-document.spec.ts` (8 tests) exercises the real chain against the real
hosted project: the owning bde attaches a real file (uploaded to and independently downloaded back
from Storage byte-for-byte, one audit row written); a practice peer who didn't author the deal is
denied; a director can attach practice-wide; an executive is denied; a file over the size limit and
a disallowed MIME type are both rejected before any Storage upload is attempted; and
`getDocumentDownloadUrl` returns a signed URL that a plain `fetch()` can actually download (content
verified byte-for-byte), while a bde outside the deal's practice can't even see the document exists
(`not_found`, the same cross-practice reasoning every other case in this codebase already uses). Run
twice consecutively to confirm fixture idempotency. New `tests/rls/documents.spec.ts` (18 tests)
proves migration 0010's RLS shape directly against local Postgres. `tests/permissions/matrix.spec.ts`
gained three named cases for `activity.attach_file` (own/practice/tenant/denied, every role) and
`tests/unit/document.spec.ts` (6 tests) covers `validateDocumentUpload`'s boundary behaviour.

Verified: typecheck, lint, unit (206, 9 new), RLS (178, 18 new), integration (66 total, 8 new,
against the real hosted project, run twice consecutively), and the full Playwright e2e suite (11,
unchanged) all green. Manual browser QA (logging an activity with a real multi-megabyte-capable PDF
attachment, confirming it renders in the timeline with a working download control after the
`window.open` fix) confirmed correct behaviour with no console errors beyond the pre-existing,
unrelated missing-favicon 404 already noted in M3.6's own entry.

**M3.9** ⚑ is a pure test-suite milestone - no application code changes - closing the two gaps a
research pass found in what M3.6/M3.7/M3.8's own work had already covered vs. left open, rather than
re-testing what already existed.

`tests/unit/dates.spec.ts` already had a WAT-crossing-midnight case for every timezone-resolving
function (`dateInTimezone`, `daysBetweenInTimezone`, `formatDateInTimezone`), including
`daysBetweenInTimezone`'s own comment literally citing this milestone by name, plus a negative-offset
(`America/Los_Angeles`) counterpart. `formatPlainDate`/`daysSincePlainDate`/`subtractDaysFromPlainDate`
correctly have no such test - they take no timezone argument at all, by design (`docs/04-metric-
definitions.md`-adjacent DATE columns like `activity_date`/`last_engaged_at` have no time-of-day to
resolve). None of this needed touching again.

What was genuinely missing, per `docs/05-test-strategy.md`'s own "Time and locale tests" section
("every date-sensitive test runs against a user in Africa/Lagos **and** a user in a negative-offset
timezone... an activity logged at 23:30 WAT shows the correct local date... `activity_date` and
`created_at` are never conflated in any response"): every existing integration/RLS test computed
`activityDate` from the real wall clock in `Africa/Lagos` only, so nothing proved the actual
**accept/reject boundary** in `logActivity`'s future-date check moves with the timezone (as opposed
to a pure-function primitive being individually correct), in either direction, against the real
hosted project - and nothing anywhere asserted the "never conflated with `created_at`" half of the
invariant with a case where the two dates actually differ.

New `tests/integration/timezone.spec.ts` (3 tests) closes both, using `logActivity`'s existing
injectable `now` parameter for a deterministic historical instant rather than depending on real wall-
clock timing:

1. 23:30 UTC on 14 June 2024 is already 00:30 on 15 June in Africa/Lagos (WAT, UTC+1) - CLAUDE.md
   #8's own named example. A UTC-based "today" would wrongly reject `activityDate = "2024-06-15"` as
   future; the correct WAT-based "today" must accept it. Asserted directly against the real
   `logActivity` call, not merely the underlying `dateInTimezone` primitive.
2. The mirror image with a negative-offset zone (`America/Los_Angeles`, UTC-7): 02:00 UTC on 15 June
   is still 19:00 on 14 June there, so an `activityDate` of "2024-06-15" (today in UTC) must be
   *rejected* as a future date for this actor, even though it is not in the future in UTC.
3. A deliberately backdated activity (`activityDate = "2024-01-01"`, `created_at` genuinely months
   later, confirmed via an independent service-role read before asserting anything - otherwise a
   coincidental match would make the test vacuous) proves `listActivitiesForDeal` and
   `getEngagementTimeline` both surface `activityDate` correctly and expose no `createdAt`/`created_at`
   field at all; `sortInstant` (the one place a DATE and an instant are ever combined, purely as an
   internal sort key - `engagementTimeline.ts`'s own comment) is confirmed still derived from
   `activityDate`, never from `created_at`.

No e2e (Playwright) equivalent: this container's browser tests have no service-role credentials to
control a precise clock or seed a precisely-timestamped row, the same documented limitation
`tests/e2e/pipeline.spec.ts`'s own comment already gives for why equivalent coverage lives in
integration tests instead of a real browser round trip.

This completes **M3** - docs/07-build-backlog.md's own exit criteria: every writing role can log an
engagement in three interactions (M3.4); the timeline is complete (M3.5), append-only (M3.1/M3.6) and
tamper-evident (M3.3's named RLS regression test, `activity_revisions`' immutability); staleness is
visible everywhere (M3.7).

Verified: typecheck, lint (unchanged), unit (206, unchanged - no `dates.ts` changes needed), RLS
(178, unchanged), integration (69 total, 3 new, against the real hosted project, run twice
consecutively), and the full Playwright e2e suite (11, unchanged) all green. No UI changed, so no
manual browser QA was needed for this milestone.

## M4 — Tasks and delegation ⚑

**M4.1** (`tasks`, `task_assignments`, `task_comments`, `task_watchers` migrations) is implemented
and verified. Schema-only milestone - no service or UI layer yet, that's M4.2 (`assignTask`) and
M4.3 (the Add Task modal) onward.

`db/schema.sql` already had a near-complete reference implementation for all four tables plus the
`blocked_needs_reason`/`done_needs_completion` constraints this milestone's own backlog line names
verbatim - but, consistent with every prior migration's own scrutiny of that reference kit, several
real gaps and deliberate deviations were found and corrected rather than silently reproduced:

- `contact_id` is deferred - it references `contacts(id)`, and `contacts` (M5.5) doesn't exist yet,
  the identical "can't reference a table that isn't there" reasoning already applied twice before
  (`activity_contacts`, M3.1; `documents.contact_id`, M3.8).
- The `next_action_task_id`/`next_action_due_date` derivation trigger
  (`refresh_deal_next_action()`, already fully written in `db/schema.sql`) is deliberately **not**
  built here - `docs/07-build-backlog.md` names it explicitly as **M4.4**'s own deliverable, the
  same structure-then-cross-table-trigger split M3.1/M3.2 already established for the engagement
  trigger.
- `updated_by` is added to `tasks`, which `db/schema.sql` omits - the identical gap migration 0005
  already found and fixed for `accounts`/`deals` against `docs/01-domain-model.md`'s own general
  rule, applied here for the same reason.
- RLS substitutes `deal_practice_line_id()`/`deal_owner_id()`/`deal_author_id()`/
  `is_deal_co_owner()` for `db/schema.sql`'s own raw `exists (select 1 from deals ...)` joins, the
  identical cross-table RLS recursion avoidance migrations 0007/0008/0010 already established for
  the same substitution. Four new helper functions (`task_tenant_id`/`task_deal_id`/
  `task_assignee_id`/`task_assigned_by`) resolve `task_assignments`/`task_comments`/`task_watchers`'
  own policies through the parent `tasks` row, the same shape `deal_co_owners` already established
  via `deal_tenant_id()`/`deal_practice_line_id()` for a child table with no `tenant_id` of its own.

**A genuine, direct doc conflict, flagged and resolved by explicit product-owner decision rather
than silently picked**: `docs/01-domain-model.md`'s own `tasks` field list says `due_date (NOT
NULL)`, but `docs/06-ui-spec.md`'s My Work screen names a "No date" grouping bucket, which only
makes sense if a task can have no due date at all. Asked; decided: `due_date` stays **NOT NULL**,
following the domain model literally - the "No date" bucket (M4.5, not built yet) will simply always
be empty in this codebase for now, the same narrower-than-spec-UI shape this project has taken
repeatedly rather than loosening a NOT NULL constraint on a guess.

Two further scope decisions were deferred rather than guessed, each flagged in the migration itself:
`task_comments.resolved_at`/`resolved_by`'s mutation path (who may resolve a comment, and how) is
undocumented anywhere and named by no M4 backlog line - no UPDATE policy exists yet for
`authenticated` (deliberately **not** `forbid_mutation()` either, unlike `task_assignments` - which
the domain model explicitly calls "the immutable reassignment ledger" - since comment resolution is
a real, plausible future write path, just not one anything asks for yet); and `snooze_count`'s
companion reason text (M4.5's own "snooze with reason after two snoozes") has no documented column
anywhere, so none is added here - that decision belongs to the milestone that actually builds
snoozing. `task_watchers` gets a SELECT policy only for the same "not invented here" reason
`deal_co_owners_insert`'s own comment already gives for its analogous gap: no "add watcher" action
exists in `docs/02-permission-matrix.md` at all yet.

`src/auth/permissions.ts` needed **no changes** - every `task.*` action and its exact
own/practice/tenant scope per role was already implemented in M0.4, verified here to match
`docs/02-permission-matrix.md`'s Tasks section cell-for-cell (including its one footnote, on
`task.assign_to_other`: "co-owners, own team lead, practice peers"). This migration is purely the
RLS layer underneath that already-correct permission matrix.

New `tests/rls/tasks.spec.ts` (34 tests, against local Postgres - the same primary-verification
shape every earlier schema-only migration in this repo used before its own service layer existed):
`blocked_needs_reason`/`done_needs_completion` (rejecting and then accepting each), the `due_date`
NOT NULL decision, `tasks_select`'s own+assigned+practice/practice/tenant scope (including a
deal-less "personal task" visible only to its own assignee/assigner, never by practice alone, since
there is no deal to derive a practice from), `tasks_insert`/`tasks_update`'s matching scope
(including the fact that RLS deliberately cannot enforce "assignee must be a valid target for my own
scope" - that's `can()`'s job in the not-yet-built `assignTask` service, the identical
coarse-RLS/fine-`can()` split `tests/rls/deals_permission_matrix.spec.ts` already documented for
`deal.change_owner`), `task_assignments`' read-only immutability (`forbid_mutation()` blocking
update/delete even for the migrator/superuser identity directly), `task_comments`' visible-scoped
read/write (including that no one can post a comment impersonating a different `author_id`), and
`task_watchers`' select-only behaviour today. No hard-delete path anywhere, confirmed directly.

Verified: typecheck, lint, unit (206, unchanged), RLS (212, 34 new), integration (69, unchanged - no
service layer exists yet to exercise against the real hosted project), and the full Playwright e2e
suite (11, unchanged) all green. Migration tested forward and backward against local Postgres before
being applied for real; `schema_migrations` on the hosted project now lists `0001` through `0011`.

**M4.2** (`assignTask` as the single assignment path, writing the ledger entry and notification) is
implemented and verified.

No `notifications` table existed anywhere - `db/schema.sql` has none to diff against, unlike
`0011_tasks`'s near-complete reference kit - so migration `0012_notifications` is authored directly
from `docs/01-domain-model.md` plus this codebase's own established patterns:

- `event_type`/`entity_type` are plain `text`, not enums, matching `audit_entries`'s own identical
  choice - the domain model's own wording ("include... alongside") describes an open-ended, growing
  vocabulary of event types spanning many future milestones, unlike closed enums like `task_status`.
- RLS is deliberately **narrower** than every other tenant-scoped table in this codebase:
  `recipient_id = auth.uid()` only, with **no** `tenant_admin`/`executive` tenant-wide override -
  `docs/02-permission-matrix.md` has no `notification.view` action at all, for any role, and
  inventing tenant-wide visibility into other users' personal notifications would be an unjustified
  overreach, not a defensible extension of an existing documented scope.
- No insert policy for `authenticated` at all - a notification is always a side effect of some other
  privileged write (this milestone's `assignTask`, later M4.7/M4.8), delivered via a service-role
  client, the same shape `writeAudit` already uses. A self-service `notifications_mark_read` update
  policy does exist, since marking one's own notification read is a genuinely different (non-
  privileged) kind of write, and never touches `recipient_id` - so it can never hit migration 0010's
  own SELECT-policy-re-validates-the-new-row trap.

`assignTask` (`src/services/tasks.ts`) operates on an **existing** task only (reassignment) - every
task already has an assignee from creation (`tasks.assignee_id not null`), so there is no separate
"first assignment" path to build. It checks `task.reassign` via `can()`, deliberately **not**
`task.assign_to_other` - the latter is a different action (creating/adding a new assignment), whose
"practice" grant for bde carries footnote 3 ("co-owners, own team lead, practice peers"), a scope
`src/auth/permissions.ts`'s `Resource` shape cannot express today. `task.reassign`'s own scope
(assigned/practice/tenant/null per role) is exactly what reassignment needs and is already fully
expressible with today's `Resource` shape (`assigneeId`/`assignedById`/`practiceLineId`, the last
resolved through the task's deal via a nested Supabase embed) - no gap there. The gap this **does**
leave, disclosed rather than silently invented: nothing validates that the new assignee is a
co-owner/team-lead/practice-peer of the actor per footnote 3's richer rule for *who* a task may land
on - only that the new assignee is a real, active user in the same tenant (a data-integrity check,
reusing `getUserByAuthId`, not a business-scope one). Closing that gap needs either a new
`ScopeToken` or a bespoke resource field this milestone does not invent unasked.

`assigned_by` is set to the reassigning actor on every call (not left unchanged) - both for correct
"who most recently assigned this" semantics, and so the resulting row still satisfies
`tasks_update`'s own RLS check via its `assigned_by = auth.uid()` branch even when the actor
reassigns a task away from themselves (losing the `assignee_id = auth.uid()` branch) - the same
"does the row I'm about to produce still satisfy my own policy" question migration 0010's
`documents_soft_delete` discovery taught this codebase to ask up front, verified directly by the
integration test where a bde reassigns their own task to someone else. The reassignment write itself
goes through the caller's own RLS-scoped session (`tasks_update`, migration 0011) - unlike
`activity.retract`, `task.reassign`'s scope already matches `tasks_update`'s own USING clause
exactly, so no service-role client is needed for that write. The `task_assignments` ledger row and
the `notifications` row are both written via a service-role client (no insert policy exists for
`authenticated` on either table), followed by a `writeAudit` call.

New `tests/integration/assign-task.spec.ts` (8 tests, against the real hosted project, seeding tasks
directly via the service-role client since no `createTask` service exists yet): a successful
reassignment writes the ledger row, the notification, and the audit row, and moves `assigned_by` to
the actor; reassigning to the current assignee is `same_assignee` with no writes; a practice peer who
is neither the assignee nor the assigner can see the task (practice-scoped `tasks_select`) but is
genuinely `denied` reassigning it (`task.reassign`'s narrower `assigned`-only scope for bde); a
practice director can reassign via the practice-wide scope; a director outside the practice gets
`not_found`, same as every other cross-practice case; a nonexistent task id is `not_found`; an
invalid new-assignee id is `invalid_assignee`, not a thrown FK error; and a deal-less personal task
can still be reassigned by its own assignee. `tests/rls/notifications.spec.ts` (8 tests, against
local Postgres) covers migration 0012 directly: recipient-only visibility (including proving a
same-tenant `tenant_admin` still can't see someone else's notification), no insert for `authenticated`
at all, self-service mark-read, and no hard-delete path.

Verified: typecheck, lint, unit (206, unchanged), RLS (220, 8 new), integration (77, 8 new, against
the real hosted project), and the full Playwright e2e suite (11, unchanged - no UI built yet, that's
M4.3+) all green. Migration `0012_notifications` tested forward and backward against local Postgres
before being applied for real; `schema_migrations` on the hosted project now lists `0001` through
`0012`.

**M4.3** (Add Task modal with the scope-filtered assignee picker; "Save and add task" continuation
from the activity modal) is implemented and verified. No new migration - this is the `createTask`
application/UI layer on top of migrations 0011/0012.

`createTask` (`src/services/tasks.ts`) is the single task-creation path, mirroring `logActivity`'s
shape: `task.create` gates whether the actor may create a task in this deal's practice at all,
`task.assign_to_self`/`task.assign_to_other` gate the chosen assignee. **A real permission bug was
found and fixed while building this**, not just a documentation nuance: `can()`'s `tokenMatches`
only ever validates the ACTOR's own role against a resource - it has no way to check a SECOND
person's (the assignee's) own role, since `Resource` carries no "the target's own practice_line_id"
field. An early version of this function assumed footnote 3 on `task.assign_to_other` ("co-owners,
own team lead, practice peers") reduced to plain practice membership and could be left to `can()`
alone; the integration test written for the "assign to someone outside the practice" case caught
that this actually let a bde assign a brand-new task to a user in a **completely different**
practice line, because `can()` was silently only ever checking the actor's side of the relationship.
Fixed by re-validating the chosen assignee against `listAssignableUsersForPractice` (the identical
query the picker itself uses) - "you can only pick who the picker offered" is now actually true
server-side, not just a UI convention (CLAUDE.md #1). **The same, already-disclosed gap in M4.2's
`assignTask` was closed with the identical fix**, since reassigning an existing task to an
out-of-scope user is no safer than creating one already pointed at them - both functions now defer
to the same `listAssignableUsersForPractice` query for this check, and both correctly order it
*after* the real-active-same-tenant-user existence check, so a nonexistent id still reads as
`invalid_assignee` rather than a misleading `denied`. For a deal-less personal task (no practice to
check against), this re-check is skipped entirely - the same relaxed shape migration 0011's
`tasks_insert` RLS policy already documents ("any practice-scoped writer may create one").

`src/data/users.ts` gained `listAssignableUsersForPractice`/`listAssignableUsersForTenant`: active,
non-deleted users holding a working role (bde/team_lead/director) in the given practice, plus any
`tenant_admin` - `executive` is deliberately excluded, since every `task.*` action that would let
them DO anything with an assigned task (`task.complete`/`task.update`) is null for that role. A task
assigned to a self-assigning actor always sends no notification ("Assigning to someone else surfaces
'They will be notified'" - docs/06-ui-spec.md implies the self-assign case doesn't); assigning to
someone else sends a real `task_assigned` notification via the same service-role path M4.2's
`assignTask` already established for `task_reassigned`.

**"Save and add task"** (LogActivityModal.tsx) is built as an embedded `AddTaskModal` instance
(`showTrigger=false`, opened imperatively via a `forwardRef`/`useImperativeHandle` handle) rather
than shared global state - each `LogActivityModal` usage on the deal page owns its own continuation,
so there's no cross-component context to wire up. `logActivityAction`'s result gained `activityId`
so the continuation can carry the just-saved activity's id forward as the new task's
`origin_activity_id`, literally "carrying the context forward" per the UI spec's own words.

Narrower than the full UI spec in ways flagged in code rather than silently built: no avatar image
in the assignee picker (no avatar system exists anywhere in this codebase yet, the same gap
`LogActivityModal`'s own "type icon" comment already names); no deal picker (`AddTaskModal` only
ever reaches the deal detail page, so "linked deal" is always that page's own deal - a deal-less/
global "Add Task" entry point belongs to M4.5's My Work screen, which doesn't exist yet).

New `tests/integration/create-task.spec.ts` (11 tests, against the real hosted project): a bde
self-assigns a task (ledger row, audit row, **no** notification); a bde assigns to a practice peer
(a real `task_assigned` notification); a bde is denied assigning to someone outside their practice
(the bug fix above, caught for real); an executive is denied creating a task at all; a director
outside the practice can't even see the deal (`not_found`); a nonexistent assignee id is
`invalid_assignee`; a deal-less personal task can be self-assigned by any practice-scoped writer;
`origin_activity_id` carries forward correctly; and `getAddTaskContext`'s picker is verified to
offer only the deal's own practice plus tenant-wide roles, correctly empty for an executive or a
cross-practice director. `tests/integration/assign-task.spec.ts` (M4.2's own suite) re-verified green
after the same fix was applied there. `tests/unit/dates.spec.ts` gained 4 tests for the new
`addDaysToPlainDate` helper (the Add Task modal's "tomorrow"/"next week" quick due-date options).

Manual browser QA (real dev server, real hosted project, a fresh Chromium session): the standalone
"Add Task" button creates a self-assigned task with the correct default due date; the "Tomorrow"
quick option sets the right date; switching the assignee to a practice peer shows "They will be
notified."; "Save and add task" from the Log Activity modal correctly closes that modal and opens
Add Task pre-filled with the deal's context, and the resulting task's `origin_activity_id` matches
the just-logged activity - all verified against real database rows, not just UI appearance.

Verified: typecheck, lint, unit (210, 4 new), RLS (220, unchanged), integration (88, 11 new for
createTask/getAddTaskContext - `assignTask`'s own pre-existing 8 re-verified green after the
permission fix), and the full Playwright e2e suite (11, unchanged) all green.

**M4.4** (`next_action_task_id` derivation trigger; the next-action strip and the "No next step"
state on the deal header) is implemented and verified.

Migration `0013_next_action_trigger` adds the FK `deals.next_action_task_id` → `tasks(id)` that
migration 0005 deferred (tasks didn't exist yet - the same "can't reference a table that isn't
there" deferral this codebase has hit repeatedly), plus `refresh_deal_next_action()` and
`trg_task_refresh`, both deliberately left out of migration 0011 (that migration's own header
comment named this exact split, mirroring the M3.1/M3.2 engagement-trigger precedent).

**A genuine bug in `db/schema.sql`'s own reference trigger was found and fixed**, not silently
ported: its `refresh_deal_next_action()` does an `UPDATE ... FROM (subquery)`, which only touches
the target row when the subquery returns at least one row. When a deal's LAST open task closes
(done, cancelled, or soft-deleted), that subquery correctly returns zero rows - so the UPDATE
touches zero rows, and `next_action_task_id`/`next_action_due_date` would be left pointing at the
now-closed task forever, never clearing back to null. Confirmed directly against local Postgres with
a manual `insert → complete → complete-the-last-remaining-one` walkthrough before writing the fix -
`next_action_task_id` really did stay stale exactly as reasoning through the SQL predicted. Fixed
with an explicit `if not found` branch that clears both columns when no open task remains -
docs/06-ui-spec.md's own "No next step - add one" empty state depends on this genuinely becoming
null, not just usually being null (CLAUDE.md #7: "a staleness indicator that is itself stale is
worse than no indicator").

`getDealDetail` (`src/data/deals.ts`) gained a `nextAction` field via a nested embed on
`tasks!next_action_task_id`, re-deriving title/due date/priority from the task row itself rather
than duplicating them onto `deals`. `NextActionStrip.tsx` renders either "Next: {title} · due
{DD/MM/YYYY}" or, when null, an amber "No next step — add one" button (only when the actor can add
tasks - otherwise plain "No next step" text) - the CTA embeds the identical `AddTaskModal` the
header's own standalone "Add Task" button already uses (M4.3), the same `showTrigger=false`
composition `LogActivityModal`'s "Save and add task" already established, so there are two entry
points to the same single creation path, not two different features.

New `tests/integration/next-action.spec.ts` (5 tests, against the real hosted project, run twice
consecutively) exercises the real `createTask` service and `getDealDetail`'s own `nextAction` field
end to end: a deal with no open tasks has a null `nextAction`; creating a task sets it; a task due
earlier becomes the new `nextAction` even though it was created second; completing the earliest task
falls back to the next-earliest remaining one; and completing the LAST remaining open task clears
`nextAction` back to null - the specific case the bug fix above targets.

Manual browser QA (real dev server, real hosted project): the amber "No next step — add one" CTA
renders next to the stage chip; clicking it opens the same Add Task modal; after saving and a fresh
page load, the strip correctly reads "Next: {title} · due {date}" - confirmed against real database
rows (`deals.next_action_task_id`/`next_action_due_date`), not just UI appearance.

Verified: typecheck, lint, unit (210, unchanged), RLS (220, unchanged), integration (93, 5 new),
and the full Playwright e2e suite (11, unchanged) all green. Migration `0013_next_action_trigger`
tested forward and backward against local Postgres before being applied for real; `schema_migrations`
on the hosted project now lists `0001` through `0013`.

**M4.5** (My Work screen: grouped queue, inline complete, snooze with reason after two snoozes,
reassign, plus the "Assigned by me" tab) is implemented and verified. No new migration - this is
entirely application/UI layer on top of what M4.1-M4.4 already built.

Two scope decisions this milestone had to make with no doc to point to, both made with reasoned
judgment and flagged in code rather than blocked on:

- **Where does a snooze's reason live?** `docs/01-domain-model.md`'s own tasks field list has
  `snooze_count` but no `snooze_reason` column - migration 0011's own comment deferred that decision
  to this milestone explicitly. A task can be snoozed many times, and a single column would only
  ever hold the LATEST reason, silently discarding every earlier one - unlike `activity.retract`'s
  one-time terminal `retraction_reason` column, snoozing is repeatable. Decided: no new column at
  all - each snooze's reason is written to `audit_entries` (action `task.snooze`), which is already
  append-only and exists precisely for "every state change writes an audit row" (CLAUDE.md #6). This
  means M4.5 needed **zero new migrations**.
- **What does "snooze" actually validate?** `newDueDate` must be strictly later than the task's
  current `due_date` - a "snooze" that moves a date earlier or leaves it unchanged is a plain edit,
  not a snooze (no "edit task" feature exists yet to route that through instead). `docs/04-metric-
  definitions.md`'s own "On-time completion rate" formula (`completed_at::date <= due_date`)
  references `due_date` in the present tense with no "original" qualifier, which is the textual
  signal this decision leans on: snoozing directly mutates `due_date` rather than needing a second
  `snoozed_until` column to preserve an original commitment date.

`src/domain/task.ts` gained `taskQueueGroup` (the five buckets docs/06-ui-spec.md names - "This
week" has no documented boundary anywhere, interpreted as a rolling 7-day window from today, the
same kind of undocumented-cutoff judgment call `stalenessBand`'s own bands already made) and
`snoozeReasonRequired` (the single shared "after two snoozes" definition the service layer and the
UI both use, so there is exactly one place that says "2"). `getTaskForAuthorization` (`src/data/
tasks.ts`) gained `status`/`dueDate`/`snoozeCount`, needed by the two new service functions:
`completeTask` (checks `task.complete`, sets `status`/`completed_at`/`completed_by` together,
satisfying migration 0011's own `done_needs_completion` constraint) and `snoozeTask` (checks
`task.update` - `docs/02-permission-matrix.md` has no distinct `task.snooze` action - validates
`must_be_later`, enforces `snoozeReasonRequired`, writes the reason to `audit_entries`).
`listMyWork` explicitly filters by `assignee_id`/`assigned_by` rather than relying on
`tasks_select`'s own broader practice-wide RLS visibility - a team_lead/director's "my work" must
never include a colleague's task just because their role could also see it. `getReassignContext`
mirrors `getAddTaskContext`'s shape but is fetched **on demand, per task** (a server action called
when a row's own Reassign control opens), since My Work lists tasks across many different deals/
practices in one queue - there is no single practice-scoped picker to pre-fetch for the whole page;
a deal-less task falls back to `listAssignableUsersForTenant` (built in M4.3 specifically for this
entry point).

The "Team" tab named in `docs/06-ui-spec.md`'s My Work section is deliberately **not** built here -
it is M4.6's own backlog line ("Team view for Team Lead and Director with per-person open, overdue
and completed counts"), the same vertical-slice-per-backlog-line discipline this project has kept
throughout.

New `tests/unit/task.spec.ts` (8 tests) covers `taskQueueGroup`'s five buckets and
`snoozeReasonRequired`'s boundary. New `tests/integration/my-work.spec.ts` (10 tests, against the
real hosted project): `completeTask` sets status/completed_at/completed_by and writes one audit row,
rejects an already-done task, and denies a practice peer who is neither assignee nor assigner;
`snoozeTask` allows two reason-free snoozes then requires one on the third (and asserts the actual
reason text landed in `audit_entries`), rejects a same-or-earlier date, and rejects snoozing a
cancelled task; `listMyWork` correctly separates "assigned to me" from "assigned by me"; and
`getReassignContext` returns a practice-scoped picker, denies an out-of-scope viewer, and falls back
to a tenant-wide picker for a deal-less task.

Manual browser QA (real dev server, real hosted project, a dedicated `manual-qa-m4-5` tenant kept
separate from every automated fixture this time - the previous milestone's QA session collided with
`next-action.spec.ts`'s own fixture deal, a lesson applied here): grouped queue renders Overdue (red)/
Due today/This week/Later correctly across a real mix of tasks; the snooze dialog's reason field
appears only from the third snooze onward, and the "reason required" error and successful save both
verified; inline complete removes a task from the queue; reassign fetches its picker on open and
correctly moves the task, visible immediately on the "Assigned by me" tab; the tab switch itself
verified via a direct URL navigation after an initial screenshot caught a client-navigation timing
artifact (not a real bug - confirmed by re-checking with `page.goto` directly).

Verified: typecheck, lint, unit (218, 8 new), RLS (220, unchanged), integration (103, 10 new), and
the full Playwright e2e suite (11, unchanged) all green.

**M4.6** (Team view for Team Lead and Director with per-person open, overdue and completed counts)
is implemented and verified. No new migration - built entirely on `getTeamOverview`
(`src/services/tasks.ts`) and the two data-layer queries it composes.

**A genuine, direct doc conflict was found and escalated before writing any code**:
`docs/06-ui-spec.md`'s own "Navigation, per role" table lists Director's nav as "Dashboard ·
Pipeline Deals · Accounts · Reviews · Analytics · Files" - no My Work, no Team entry at all - while
this same milestone's own backlog line explicitly names "Team Lead **and Director**", and that same
doc's own My Work section describes Team as "a third tab" leaders see. Asked via `AskUserQuestion`
with three options (add a `/team` nav entry for Director; Team Lead only for now, deferring
Director; or repurpose Director's existing `/reviews` placeholder); the user did not answer, so the
recommended default was taken - Director's nav gained the same `/team` entry Team Lead already had,
flagged explicitly in `src/domain/navigation.ts`'s own comment on that array and in a dedicated
`tests/unit/navigation.spec.ts` assertion documenting the deviation from the table's literal text.

Routing itself reconciles both doc readings rather than picking one over the other: `/team` is a
real, separate top-level route (matching the nav table's own structure - and one that already
existed as an M0-era placeholder page, reused here rather than duplicated), but it renders with the
identical tab-bar styling My Work's own two tabs use (`src/ui/nav/WorkTabs.tsx`, shared by both
pages) - one visual tab bar spanning two routes, satisfying the "third tab" prose too.

`getTeamOverview` scopes "the team" to every working-role holder (bde/team_lead/director) in the
SAME practice line(s) the actor themselves holds a team_lead/director grant for -
`docs/02-permission-matrix.md`'s `task.view` is practice-scoped for both roles, so a tenant-wide
roster would over-reach either role's actual entitlement. An actor holding no team_lead/director
grant at all is denied - this view exists for leaders, not individual contributors. Counts are read
through the CALLER's own RLS-scoped session, not a service-role client: `tasks_select`'s own
practice branch requires `deal_id is not null`, so a deal-less personal task belonging to someone
OTHER than the viewer stays invisible even to their own team lead - the same privacy boundary RLS
already establishes everywhere else in this codebase, not a new gap this feature introduces.
"Completed" has no documented time window anywhere - a rolling 7-day window, the same judgment call
`taskQueueGroup`'s own "this week" bucket already made (M4.5), so the count doesn't grow unbounded
forever.

New `tests/integration/team.spec.ts` (3 tests, against the real hosted project): a team_lead sees
per-person open/overdue/completed counts for their own practice, correctly excluding a bde from a
different practice line; a director in the same practice sees the identical roster and counts
(proving the scope is genuinely practice-based, not role-based); and a plain bde with no
team_lead/director grant is denied. `tests/unit/navigation.spec.ts` gained the Director-nav
assertion above and an updated `/team` role-access assertion (now `team_lead` and `director`, not
`team_lead` alone).

Manual browser QA (real dev server, real hosted project, the same dedicated QA tenant M4.5 used,
with a team_lead user added to it): the Team page renders all three practice members with correct
per-person counts reflecting real prior QA activity; the shared tab bar correctly shows all three
tabs for a team_lead session, verified via direct URL navigation (the same client-navigation timing
artifact from M4.5's own QA reappeared here and was confirmed non-functional the same way - a fresh
`page.goto` shows the correct state immediately).

Verified: typecheck, lint, unit (219, 1 net new - the navigation suite gained a Director-specific
assertion), RLS (220, unchanged), integration (106, 3 new), and the full Playwright e2e suite (11,
unchanged) all green.

**M4.7** ("No next step" filter and dashboard tile listing active deals lacking an open task) is
implemented and verified. No new migration - `next_action_task_id` (M4.4) and its own partial index
(`deals_no_next_action`, migration 0005) already anticipated this exact feature.

The filter (`noNextStep` on `DealListFilters`, `src/data/deals.ts`) is deliberately the exact
complement of `docs/04-metric-definitions.md`'s own "Next-action coverage" metric ("active deals
with `next_action_task_id is not null`, over all active deals") - not a looser "next_action_task_id
is null" on its own, which would also (wrongly) match every closed won/lost deal. Setting the
checkbox filters to `status = 'active' AND next_action_task_id is null`, matching the schema
author's own partial index exactly and keeping the query index-backed. Combining the checkbox with
an explicit conflicting `status` filter (e.g. "Won") is a genuine contradiction and correctly
returns zero rows rather than silently picking one side - verified directly in the new integration
test.

The dashboard (`app/(app)/dashboard/page.tsx`) was a bare M0-era stub before this - this is the
first real tile it has ever had, and deliberately just JSX, not a new tile/grid abstraction: one
tile doesn't earn a reusable component, the real analytics build (M6) is where that pattern would
actually pay for itself. The tile shows a count (in `risk` orange when non-zero) and links to
`/deals?noNextStep=1`; a new `countDealsWithoutNextAction` (`src/data/deals.ts`) backs it - a plain
`count: "exact", head: true` query, not a fetch of every joined column `listDeals` pulls, since the
tile only needs the number. Read through the caller's own RLS-scoped session (no service-role
client), so it automatically matches whatever the Pipeline list itself would show a Director (their
own practice), an Executive, or a tenant_admin (tenant-wide) with the same filter applied - zero new
authorization code, same as every other read in this app.

New `tests/integration/no-next-step.spec.ts` (5 tests, against the real hosted project, its own
dedicated tenant rather than extending `pipeline-list.spec.ts`'s large shared fixture so the
tenant-wide count assertion stays exact and unambiguous): the filter returns only the active,
task-less deal; excludes a deal with an open task; excludes a *won* deal with no task (proving
"active AND no next step," not merely "no next step"); confirms the conflicting-filter-combination
zero-row behaviour; and confirms `countActiveDealsWithoutNextAction` counts exactly one. Also
extended `tests/unit/pipelineViewLinks.spec.ts` with a direct `noNextStep` preservation assertion.

Manual browser QA (real dev server, real hosted project, the same dedicated QA tenant, with a
director user added to it and a second QA deal seeded with no open task): the dashboard tile
correctly showed "1" in risk orange with the right copy; the tile's own link correctly landed on
the Pipeline table filtered to that one deal; and a direct `/deals?noNextStep=1` navigation showed
the checkbox correctly pre-checked from the URL and the table correctly narrowed to just that deal.

Verified: typecheck, lint, unit (220, 1 new), RLS (220, unchanged), integration (111, 5 new), and
the full Playwright e2e suite (11, unchanged) all green.

**M4.8** (notification events for assigned, reassigned, overdue and mentioned, with per-type user
preferences replacing coarse toggles) is implemented and verified, including a new migration
(`0014_notification_preferences`) applied to the real hosted project. Full reasoning lives in
`db/migrations/README.md`'s own `0014` entry and this migration's own header comment; summarized
here:

Three decisions had no doc to point to and were made by explicit user choice rather than guessed
(asked via `AskUserQuestion` before writing any code, since CLAUDE.md says to stop and ask rather
than silently assume on business rules this size): `task_overdue` fires **once** per task, not a
repeating daily nag; the overdue sweep runs on a **real `pg_cron` schedule** (every 15 minutes - a
judgment call, not documented) rather than staying callable-only; and **`mentioned`** is added to
the preference set now, even though nothing can actually fire it until M4.9 wires up comment
creation (`task_comments` has zero service-layer code today).

`sendNotification` (new `src/services/notifications.ts`) is the single gate every notification-
writing call site now goes through - `createTask`/`assignTask`'s existing `task_assigned`/
`task_reassigned` writes were rewired to it, both confirmed unaffected by the new default-on
behaviour (their own pre-existing integration tests still pass unchanged). `sweep_overdue_tasks()`
is a single atomic SQL function, the first background job in this codebase, deliberately without a
separate job-tracking table - `notifications`' own `(entity_id, event_type)` pair, backed by a new
partial unique index, is idempotency enough for a job this simple (CLAUDE.md #6: no premature
abstraction). Its status filter excludes `'blocked'` tasks, matching migration 0011's own pre-built
`tasks_overdue` index exactly - a disclosed, deliberate divergence from `taskQueueGroup`'s own
"Overdue" UI bucket, which has no such carve-out.

This session hit two infrastructure firsts worth recording: this sandbox has no raw-TCP egress to
the hosted project's Postgres, so applying the migration required a Supabase Management API
Personal Access Token, supplied by the user mid-session (the same mechanism migrations `0006`-`0013`
used before it). And building this migration surfaced a genuine, disclosed gap in the **local** test
harness - `authenticated`'s privileges on every table through `0013` came from an undocumented,
one-off manual `GRANT`, not from any versioned migration or default-privileges rule, and didn't
match the real hosted project's own default grants (verified directly). Fixed at the source
(`scripts/db-bootstrap-local.sh` now sets `alter default privileges for role app_migrator`) rather
than worked around per-table; one consequence flagged rather than silently diverged from -
`tests/rls/notificationPreferences.spec.ts`'s own "no hard-delete" test asserts 0 rows affected
(matching real Supabase's actual RLS-does-the-blocking model), while the older
`tests/rls/notifications.spec.ts` test it mirrors asserts a thrown permission error (an artifact of
that table's own local-only under-grant) - not "fixed" there, out of scope for this migration, but
called out in both files rather than left for a future session to rediscover.

A personal "Notification preferences" screen (`/notifications/preferences`) was built alongside the
gate - not role-gated (every user manages their own), reachable from a new link in `AppShell`'s
persistent footer rather than any role's own `Nav`. Manual browser QA (real dev server, real hosted
project) confirmed a toggle takes effect immediately and survives a hard reload.

New `tests/rls/notificationPreferences.spec.ts` (10 tests, local Postgres) and
`tests/integration/notification-preferences.spec.ts` (8 tests, real hosted project - the preference
gate's opt-out/opt-back-in behaviour through real `createTask`/`assignTask` calls, and
`sweep_overdue_tasks()` called via RPC exactly as `pg_cron` invokes it in production, proving it
fires once, respects the per-user opt-out, and never double-fires on a repeat sweep).

Verified: typecheck, lint, unit (220, unchanged), RLS (230, 10 new), integration (119, 8 new), and
the full Playwright e2e suite (11, unchanged) all green.

**M4.9** (Comments, watchers and @mention with an in-scope user picker) is implemented and
verified - the largest single M4.x slice so far, by explicit user direction: two follow-up
questions surfaced real business-rule gaps neither `docs/01-domain-model.md` nor
`docs/06-ui-spec.md` answered (how someone becomes a watcher; whether comment resolution belongs in
this milestone at all), and the user chose the most complete option each time - both automatic and
manual watchers, and building resolve/unresolve now rather than deferring it further.

`@mention` is a picker, not free-text `@handle` parsing: the comment composer offers checkboxes over
the same in-scope population the assignee picker already produces
(`listAssignableUsersForPractice`/`Tenant`, matching `task.mention_user`'s own practice/tenant scope
in the permission matrix) - satisfying "an in-scope user picker" literally, without inventing a
markup/escaping format nobody asked for. Watchers are automatic (a task's assignee and assigner from
creation, the new assignee on reassignment, an @mentioned user from a comment) AND manual
(`task.watch` - self-add; `task.add_watcher` - add someone else, re-validated server-side against
the same in-scope population, the identical "you can only pick who the picker offered" discipline
`createTask`'s own assignee re-check already established). There is still no "unwatch" action -
genuinely not named by this milestone. Comment resolution reuses `resolved_at`/`resolved_by`
(migration 0011, left unwired until now) and is scoped like `task.update`, not comment authorship -
a task's assignee/assigner (or a practice lead) can resolve feedback even if someone else wrote it.

Three new permission actions (`task.watch`, `task.add_watcher`, `task.resolve_comment`) were added
to `docs/02-permission-matrix.md` and `src/auth/permissions.ts`, each mirroring an existing action's
exact scope shape rather than inventing a new one, with named positive/negative test cases added to
`tests/permissions/matrix.spec.ts` per CLAUDE.md's own permission-test rule. New migration `0015`
adds the two RLS policies migration 0011 deliberately deferred (`task_watchers_insert`,
`task_comments_resolve`) - applied to the real hosted project via the Management API, the same
no-raw-TCP-egress path every migration since `0006` has used. `tests/rls/tasks.spec.ts`'s own
`task_watchers` test block, which previously pinned "no insert policy exists yet" as correct
behaviour, was rewritten to prove the new M4.9 behaviour instead, plus a new `task_comments_resolve`
block.

New service layer: `src/data/taskComments.ts`, `src/data/taskWatchers.ts`,
`src/services/taskComments.ts` (`getTaskCommentsContext`, `createTaskComment`, `resolveTaskComment`,
`addWatcher`); `src/services/tasks.ts`'s `createTask`/`assignTask` gained the automatic-watcher
wiring. New UI: no task-detail page exists anywhere in this codebase, so this follows the exact
`<dialog>`-per-row idiom `TaskRow.tsx`'s own Snooze/Reassign dialogs and `AddTaskModal.tsx` already
established - a new "Comments" button opens `TaskCommentsDialog.tsx`, showing watchers, the comment
thread with per-comment resolve/unresolve, and a comment composer with the mention picker.

New `tests/integration/task-comments.spec.ts` (12 tests, against the real hosted project, real
signed-in sessions throughout): `createTask`'s auto-watch behaviour; posting a comment as anyone
with task visibility; @mentioning an in-scope user adding them as a watcher AND sending a real
"mentioned" notification (the first time that event type actually fires, since M4.8 built its
preference plumbing with no trigger yet); mentioning yourself sending no notification; mentioning an
out-of-scope user being rejected; `addWatcher`'s self/other paths, including the out-of-scope
rejection; and `resolveTaskComment`'s task-state-not-authorship scoping, including an executive
being denied at the `can()` level before RLS is ever reached. Manual browser QA (real dev server,
real hosted project, the existing dedicated QA tenant) confirmed the Comments dialog end to end:
watchers list, mention checkboxes, posting a comment that correctly added the mentioned user as a
watcher, and both the resolve and unresolve toggle.

Verified: typecheck, lint, unit (228, 8 new), RLS (236, 6 new), integration (131, 12 new), and the
full Playwright e2e suite (11, unchanged) all green.

**M4.10** (⚑ "Permission tests: a BDE can assign to a practice peer; an Executive cannot assign at
all; reassignment history is never overwritten") is implemented and verified. This is the milestone
that closes out M4 entirely - test-hardening only, no new feature. An audit agent mapped exactly
what the three named assertions already had coverage for versus what was genuinely missing before
any test was written, so this didn't duplicate the substantial coverage M4.1-M4.9 already built
along the way.

New `tests/permissions/task-matrix.spec.ts` mirrors `deal-matrix.spec.ts`'s own exhaustive
per-role/per-action style (M1.8's precedent for a `⚑` permission milestone) across all thirteen
`task.*` actions - the first exhaustive, resource-shape-driven proof of every task action's scope
for every role, not just the four named cases the generic `matrix.spec.ts` had. Tasks needed a
5-shape grid, not deals' 4-shape one: a task has TWO independent person-relations (`assigneeId`/
`assignedById`, "assigned"/"assigned_by"), where a deal has one (`ownerId`, "own"). That extra
dimension is exactly what surfaces a real, easy-to-miss asymmetry this file now pins down as a
named regression case: `task.reassign` grants `["assigned"]` only, never `["assigned_by"]` - the
task's CURRENT assignee may hand it onward, but whoever originally assigned it away cannot reclaim
it themselves without practice-wide reach. `assignTask`'s own comment already documented this;
it was never actually regression-tested as a specific fact until now.

Two real, disclosed gaps were found and fixed, not merely tested around:
- `tests/rls/tasks.spec.ts`'s `task_assignments` immutability test only ever exercised the
  migrator/superuser identity - extended to prove `forbid_mutation()` also blocks an authenticated
  `tenant_admin` session, the same two-tier shape `tests/rls/audit_log.spec.ts` already established
  for the other immutable ledger table in this schema. Doing this surfaced a genuine local-only
  privilege gap: local Postgres's `authenticated` role has never had DELETE granted on ANY table
  (only SELECT/INSERT/UPDATE) - a one-off historical grant predating this session that undershoots
  the real hosted project's actual privilege model (which grants DELETE broadly too, with RLS alone
  restricting it). A blanket "grant delete on all tables" fix was tried and immediately reverted -
  it broke several OTHER tables' own already-passing "no hard delete" RLS tests, which assert a
  THROWN "permission denied" error that stops being true once DELETE is genuinely granted and RLS
  (correctly) reduces the statement to zero affected rows instead. Fixing every one of those
  tests is real, valuable cleanup, but out of scope for this milestone - so `scripts/db-bootstrap-
  local.sh` only grants DELETE on the two tables a real test exercises today
  (`notification_preferences`, M4.8; `task_assignments`, M4.10), with the broader gap called out
  explicitly in that script's own comment for whenever it's worth fixing properly.
- `tests/integration/assign-task.spec.ts` never had an executive fixture user at all - added one,
  plus a named "an executive cannot reassign a task at all, even though they can see it tenant-wide"
  case, closing the one integration-level hole in the M4.10 backlog line's second named assertion
  (executive denial for *creating* a task was already covered in `create-task.spec.ts`; reassigning
  an existing one was not).

Verified: typecheck, lint, unit (297, 69 new), RLS (237, 1 new), integration (re-run individually
and confirmed green: `assign-task.spec.ts`'s new case, 9/9), and the full Playwright e2e suite (11,
unchanged) all green. No new migration and no change to the real hosted project - this milestone's
only fix (the local DELETE-grant gap) is scoped to the local RLS test harness alone.

**Milestone 4 (Tasks and delegation) is complete.** M5.1 (`outcome_reasons` admin configuration;
`deal_outcomes` migration) starts Milestone 5 (Win/loss discipline and contacts) and is implemented
and verified.

New migration `0016` creates both tables, closing real gaps in `db/schema.sql`'s own reference
definitions rather than reproducing them verbatim (the same discipline migration 0005 established
for accounts/deals): `outcome_reasons.type` becomes a proper `outcome_type` enum instead of a bare
`text check`; `outcome_reasons` gains `created_at`/`updated_at`/`created_by`/`updated_by`
(schema.sql omits them, unlike its own `pipeline_stages` sibling) and a
`unique (tenant_id, type, label)` constraint (schema.sql has none); `deal_outcomes` gains a
`final_value_needs_currency` check alongside schema.sql's own `loss_requires_detail` check, kept
verbatim. Applied to the real hosted project via the Management API, same as every migration since
`0006`.

Two decisions were deliberately left to the milestones that actually need them, not guessed now:
how a loss reason gets recognised as "lost to competitor" (M5.2's own job), and whether a recorded
outcome can ever be revised (nothing through M5.4 names that action, so `deal_outcomes` gets
SELECT/INSERT policies only). RLS mirrors two existing tables exactly - `outcome_reasons` mirrors
`pipeline_stages`, `deal_outcomes` mirrors `deals_select`/`deals_update` - rather than inventing new
shapes.

While adding a real DELETE-permission test for `task_assignments`' own immutability (M4.10's own
exit criterion), a second local-only grant gap surfaced: literally every pre-existing local table
was missing DELETE for `authenticated` (the real hosted project grants it broadly everywhere,
confirmed directly) - the same class of gap M4.8 found for `notification_preferences`. A blanket
fix immediately broke several other tables' own already-passing "no hard delete" tests elsewhere in
the suite, so the fix (`scripts/db-bootstrap-local.sh`) stayed narrowly scoped to the two tables a
real test actually exercises: `notification_preferences` and `task_assignments`. Fixing every other
table's own assertions to match the more accurate model is real work, deliberately left as its own
separate, disclosed cleanup rather than an unplanned tangent inside M5.1.

Built `app/(app)/admin/outcome-reasons/` - this codebase's first admin CRUD screen.
`src/services/outcomeReasons.ts` enforces `admin.manage_outcome_reasons` explicitly via `can()`,
narrower than what migration 0016's own tenant-wide SELECT RLS would otherwise allow (the admin
screen is deliberately not the same audience as "everyone who will eventually pick a reason when
closing a deal," M5.3's own concern) - CLAUDE.md #1's "UI hiding is never the sole control" applies
in the other direction here too: a route being tenant_admin-only doesn't excuse the service from
checking `can()` itself. `admin.manage_outcome_reasons` was already correctly wired in
`src/auth/permissions.ts` from early scaffolding but had never been called by anything until now,
and had no named test case anywhere - both fixed as part of this milestone (a new case in
`tests/permissions/matrix.spec.ts`).

New `tests/rls/outcomeReasonsAndDealOutcomes.spec.ts` (17 tests, local Postgres) covers both
tables' full RLS shape plus both check constraints. New `tests/integration/outcome-reasons.spec.ts`
(4 tests, against the real hosted project, real signed-in sessions) proves the admin service end to
end - list/create/(de)activate for tenant_admin, denial at the can() level for a bde even though
RLS itself would let them read the table, and the duplicate-label constraint firing for real.
Manual browser QA (real dev server, real hosted project, the existing QA tenant with a new
tenant_admin user) confirmed create, deactivate and reactivate all work correctly - one screenshot
briefly showed a stale client-render before `router.refresh()` settled (the same benign timing
artifact this session's own QA has hit before, confirmed non-functional by a direct page reload
showing the correct state immediately).

One environment hiccup, not a code regression, worth recording since it briefly looked like one:
a leftover `next-server` process from an earlier manual-QA session was still squatting port 3000,
so a subsequent e2e run silently started its own dev server on port 3001 while Playwright's own
`webServer` config (`reuseExistingServer: true` locally) kept talking to the STALE process on
port 3000 - two unrelated, pre-existing tests failed against that stale server. Killing every
leftover `next-server`/`next dev` process and restarting cleanly on port 3000 fixed it immediately;
the full e2e suite (11/11) then passed against the current code.

Verified: typecheck, lint, unit (298, 1 new), RLS (254, 17 new), integration (136, 4 new), and the
full Playwright e2e suite (11, unchanged, after clearing the stale-process hiccup above) all green.

**M5.2** ("`closeDeal` service: atomic outcome, stage event, status, open-task cancellation, audit.
Closing is impossible without a reason; loss requires detail; lost-to-competitor requires a name.")
is implemented and verified. This is the milestone that finally pays down a debt disclosed since
M1.5: every compound write until now (`createDeal`, `changeStage`) was several sequential
Supabase-client calls with an explicitly non-atomic gap, because PostgREST has no client-side
multi-statement transaction. `closeDeal` touches four tables plus `audit_entries` in one write - the
highest-risk compound write yet - so new migration `0017` builds the real fix instead: `close_deal`,
a single `security definer` Postgres function invoked through one `.rpc()` call, wrapping the deal
status/stage update, the `stage_events` insert, the `deal_outcomes` insert, open-task cancellation,
and the audit entry in one genuine Postgres transaction. This is the first truly atomic compound
write in this codebase - see `db/migrations/README.md`'s `0017` entry for the full reasoning,
including a real bug (an untyped `case` expression in the target-stage lookup) the manual local
verification pass caught before the migration ever reached the hosted project.

Migration 0017 also resolves the one decision 0016 deliberately deferred: a reason is recognised as
"lost to competitor" via a new `requires_competitor_name` boolean on `outcome_reasons`
(tenant-admin-settable per reason, meaningless for a win reason by check constraint) rather than by
matching a fragile label string or requiring a competitor name on every loss unconditionally. The
existing outcome-reasons admin screen (M5.1) gained a checkbox for it, shown only for loss-type
reasons - without this, the flag the whole feature depends on could never actually be set.

`src/services/deals.ts`'s new `closeDeal` is the exclusive way a deal ever reaches won/lost -
`changeStage` already refused a won/lost target stage since M1.5, specifically deferring to this
function. Every check the RPC performs is duplicated here first (already-closed, reason
tenant/type match, loss-requires-detail, competitor-name-required), the same "TS `can()` is the real
gate, the privileged write repeats it as a non-bypassable backstop" split `writeStageEvent`/
`writeAudit`/`sweep_overdue_tasks` already use - so a caller gets a clean `CloseDealResult` code
instead of a raw Postgres exception. `deal.mark_won`/`deal.mark_lost` needed no new permission-matrix
work: both already shared `deal.update`'s own/practice/-/tenant scope from M5.1's own survey and were
already exhaustively covered by `tests/permissions/deal-matrix.spec.ts`'s generic `DEAL_ACTIONS`
list.

New `tests/rls/closeDeal.spec.ts` (9 tests, local Postgres) calls `close_deal` directly through real
`authenticated` sessions, proving the RPC's atomicity (every rejected path leaves all four tables
untouched), its rejection paths, and - deliberately, not as a gap - that it does not itself re-check
per-deal authorisation, the same trust relationship `writeStageEvent`/`writeAudit` already have with
their callers. New `tests/integration/close-deal.spec.ts` (8 tests, against the real hosted project,
real signed-in sessions) proves `closeDeal`'s own TS-layer result codes end to end: a bde winning or
losing their own deal, an executive denied before any write, and clean codes for every rejection
path. Manual browser QA confirmed the admin screen's new checkbox: visible only for a loss-type
reason, and a created competitor-required reason correctly shows a "(requires competitor name)"
marker in the list. No new UI beyond that checkbox - the Mark Won/Mark Lost dialogs are M5.3's job.

Verified: typecheck, lint, unit (298, unchanged), RLS (263, 9 new), integration (144, 8 new), and
manual browser QA of the outcome-reasons admin checkbox, all green. The Playwright e2e suite was not
re-run - no UI this milestone touches has e2e coverage today, and no existing e2e path exercises the
outcome-reasons admin screen or any deal-closing flow.

**M5.3** ("Mark Won and Mark Lost dialogs enforcing the above.") builds the first UI for M5.1/M5.2's
rules - the only way a deal reaches won or lost through this app now that a UI actually exists for
it, `src/services/deals.ts`'s `closeDeal` underneath.

Two new service functions back the dialogs: `getActiveOutcomeReasons` (`src/services/
outcomeReasons.ts`) - unlike the M5.1 admin screen's own `getOutcomeReasons`, this has no
`admin.manage_outcome_reasons` gate at all, since migration 0016's own `outcome_reasons_select` RLS
policy already makes reading the picklist a plain tenant-wide read, the same "RLS alone is the whole
authorisation boundary" reasoning `listPipelineDeals`/`getDealDetail` already rely on - scoped to
active-only and one type (`win`/`loss`), backed by a new `listActiveOutcomeReasonsByType` in
`src/data/outcomeReasons.ts`; and `getCloseDealAvailability` (`src/services/deals.ts`), the same
`canLogActivity`/`canRetractActivity` shape `src/services/activities.ts` already established -
computed once per deal, gating the two buttons' visibility on both `deal.mark_won`/`deal.mark_lost`
and the deal not already being won or lost (mirroring `closeDeal`'s own `already_closed` guard,
deliberately not narrowed to `status === "active"` only - an `on_hold` deal is closeable too, exactly
as `closeDeal` itself already treats it).

`docs/06-ui-spec.md`'s only text on this ("under a menu: Mark Won, Mark Lost, Escalate, Add Contact")
was deliberately not followed literally: Escalate and Add Contact don't exist yet either, and this
codebase has no dropdown-menu primitive anywhere - building one for two buttons ahead of a third and
fourth action actually needing it would be premature abstraction (CLAUDE.md #6). `MarkWonModal.tsx`
and `MarkLostModal.tsx` (`app/(app)/deals/[id]/`) instead render as two plain trigger buttons next to
Edit deal, following the exact native-`<dialog>` modal convention `LogActivityModal`/`AddTaskModal`
already established (per-instance `useId`, autofocus on open, Ctrl/Cmd+Enter to save, Escape to
close) rather than inventing a new one. Money input follows the edit-deal form's own established
three-step pattern (`src/domain/money.ts`'s `toMinorUnits`/`toMajorUnitsString`, an optional
regex-validated string field, converted only in the server action) - there is no currency picker
anywhere in this codebase, so `finalValueMinor` is always paired with the deal's own existing
`currencyCode` (from `getDealForEditView`, already fetched by the page) rather than ever asking the
user to choose one, which is what actually satisfies migration 0016's `final_value_needs_currency`
check constraint (both null or both set) without inventing UI nothing asks for.

`MarkLostModal`'s competitor-name field is the one genuinely dynamic piece: it only appears, and is
only required, once the selected reason's own `requiresCompetitorName` is true - a per-reason
runtime fact, not something a static Zod schema can express, so `markLostSchema` deliberately leaves
`competitorName` optional and the modal enforces it client-side once a reason is picked;
`closeDeal`'s own `competitor_name_required` result code remains the authoritative backstop either
way. Both dialogs default their close-date field to today (the actor's own timezone,
`dateInTimezone`) and reject a future date the same way `LogActivityModal`'s `activityDate` already
does - not documented anywhere, but the same inferred default as an existing, precedented pattern
rather than a genuinely new business-rule guess. An empty active-reasons list (a fresh tenant, or an
admin who deactivated every reason of one type) is a designed state, not an unhandled edge case: the
picker is replaced with a message naming the gap, and the submit button is disabled, since "closing
is impossible without a reason" makes there nothing useful to submit.

`app/(app)/deals/actions.ts`'s `changeStageAction` had a placeholder message from M2.2 predating this
milestone ("isn't available yet - use Mark Won or Mark Lost when they land"); updated now that they
exist, to state plainly that dragging to a won/lost stage isn't supported at all, not merely
deferred.

New `tests/integration/outcome-reasons.spec.ts` coverage (1 new test, against the real hosted
project) proves `getActiveOutcomeReasons` end to end: a plain bde with no admin grant can read it,
correctly scoped to one type and to `is_active = true`, excluding a reason an admin just deactivated.
`getCloseDealAvailability` gained no dedicated test of its own - the same precedent
`canLogActivity`/`canRetractActivity` already set, since it composes two already-exhaustively-tested
things (`can()`'s own matrix tests, `closeDeal`'s own already-closed guard) rather than adding new
logic of its own.

Both dialogs were driven end to end in a real browser against the real hosted project rather than
only unit/integration-tested: signed in as a bde, Mark Won on one deal (reason picker populated,
final value "1200000.50" converted and paired with the deal's currency, dialog closed on success) and
Mark Lost on another (submitting with no detail produced the inline error without a server round
trip, selecting a competitor-required reason made the competitor-name field appear and become
required, submitting with it produced the correct final state) - verified both by the dialogs'
own behaviour and directly against the database (`deal_outcomes.final_value_minor` exactly
120000050, `currency_code` `NGN`, `reason_detail`/`competitor_name` recorded correctly on the loss),
then confirmed on a fresh full page load that both buttons correctly disappear once a deal is closed
and the header/details sections show the final Won/Lost state.

Verified: typecheck, lint, unit (298, unchanged), RLS (263, unchanged - no new migration this
milestone), integration (145, 1 new), and full manual browser QA of both dialogs against the real
hosted project, all green.

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
