# Pipeline Intelligence

A multi-tenant workforce leads and pipeline management platform for professional-services
business development, being rebuilt from a greenfield specification set.

Start here, in order:

1. [`CLAUDE.md`](./CLAUDE.md) — project constitution. Highest authority in this repository.
2. [`docs/DECISIONS.md`](./docs/DECISIONS.md) — open questions blocking implementation, and
   decisions already made (some currently **provisional**, pending product-owner confirmation).
3. [`docs/07-build-backlog.md`](./docs/07-build-backlog.md) — the dependency-ordered milestone
   backlog (M0–M9). **M0 — Foundation is complete.** **M1 — Deals and pipeline is complete.**
   Current milestone: **M2 — Engagement history**, through task M2.1/M2.2.
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
