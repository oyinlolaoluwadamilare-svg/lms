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
