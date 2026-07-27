# CLAUDE.md — Project Constitution

> This file is the highest authority in this repository. If any instruction, document, or
> generated suggestion conflicts with this file, this file wins. Read it in full at the
> start of every session before writing code.

## 1. What we are building

**Pipeline Intelligence** — a multi-tenant workforce leads and pipeline management platform for
professional-services business development organisations. Consulting, advisory, learning,
outsourcing and executive-search practices sell multi-stakeholder engagements with long cycles.
The product exists to make the *work* on a deal visible, owned and measurable — not merely to
store the deal's current state.

**The single sentence that governs every scope decision:**
Anyone must be able to answer "what is being done about this deal, by whom, and by when?" in
under five seconds, and every pipeline metric must be derived from recorded events rather than
manually maintained fields.

## 2. Non-negotiable invariants

These are correctness requirements, not preferences. Violating one is a bug even if tests pass.

1. **Server-side authorisation always.** Every read and write is authorised on the server against
   the permission matrix in `docs/02-permission-matrix.md`. UI-level hiding is presentation only
   and is never the sole control. A hidden button is not a permission.
2. **Row-level security on every table.** Every tenant-scoped table has RLS enabled with policies
   keyed on tenant and, where applicable, practice-line entitlement. A table without RLS does not
   ship.
3. **Never hard delete.** No user-facing code path issues `DELETE`. Use `deleted_at` soft delete
   with a recycle bin. Permanent purge is an out-of-band platform operation only.
4. **Engagement history is append-only.** Activities, stage events and audit entries are never
   overwritten. Corrections are revisions or retractions that preserve the original.
5. **Engagement date and record timestamp are different things.** `activity_date` is when the
   engagement happened. `created_at` is when it was typed in. Both are always stored, always
   distinguishable, and never conflated in any query, export or API response.
6. **Every state change writes an audit row.** No exceptions for "minor" fields.
7. **Derived fields are computed transactionally on write**, never by nightly batch. A staleness
   indicator that is itself stale is worse than no indicator.
8. **Timestamps stored in UTC, rendered in the user's timezone.** Default tenant timezone is
   Africa/Lagos (WAT, UTC+1). Default date display format is DD/MM/YYYY.
9. **Money is never a float.** Store minor units as `bigint` with an explicit currency code.
10. **No personal data in URLs, query strings, or log lines.**

## 3. Stack

Do not substitute these without an explicit decision recorded in `docs/DECISIONS.md`.

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node 20 LTS, TypeScript 5.x strict | `strict: true`, `noUncheckedIndexedAccess: true`, no `any` |
| Framework | Next.js (App Router) | Server components by default; client components only where interaction demands |
| Database | PostgreSQL via Supabase | RLS is the primary authorisation boundary |
| Auth | Supabase Auth | Email/password plus OAuth for mail connectors; MFA-ready |
| ORM / access | Typed SQL via Drizzle or Kysely | No stringly-typed queries; migrations in version control |
| Validation | Zod at every boundary | One schema per entity, shared by API and form |
| Styling | Tailwind CSS with design tokens from `docs/06-ui-spec.md` | No inline hex values in components |
| Testing | Vitest (unit), Playwright (e2e), pgTAP or SQL fixtures (RLS) | See `docs/05-test-strategy.md` |
| Background work | Queue-backed jobs (Supabase cron plus a job table) | Idempotent, retried with backoff |
| Observability | Structured JSON logging with request and tenant correlation | Never log personal data |

## 4. Repository layout

```
/app                 Next.js routes, grouped by role-agnostic feature
/src
  /domain            Pure business logic. No I/O, no framework imports. Fully unit-tested.
  /data              Repositories. The only place SQL lives.
  /services          Orchestration: transactions, events, notifications, audit.
  /auth              Permission matrix implementation and guards.
  /ui                Design-system primitives and shared components.
  /lib               Cross-cutting helpers (dates, money, ids).
/db
  /migrations        Sequential, reversible, reviewed.
  /policies          RLS policy definitions, one file per table.
  /seed              Deterministic seed data.
/tests
  /unit  /integration  /e2e  /rls  /permissions
/docs                The specification set. Treat as source of truth.
```

**Layering rule, enforced by lint:** `domain` imports nothing from `data`, `services`, `app` or
`ui`. `data` imports only `domain` and `lib`. `app` never contains business logic or SQL.

## 5. How to work in this repository

**Work in vertical slices.** A slice is migration plus policy plus repository plus domain logic
plus API plus UI plus tests, for one capability, shippable on its own. Never build a horizontal
layer across the whole product.

**Follow the build order in `docs/07-build-backlog.md`.** It is dependency-ordered. Do not start
a milestone whose predecessor is incomplete.

**One task per session.** Each backlog task is scoped to a single working session. If a task
appears to need more, stop and propose splitting it rather than producing a large unreviewable
change.

**Definition of done** — every item, every time:
- Acceptance criteria demonstrably met.
- Unit tests for domain logic; integration tests for repositories; e2e test for the primary path.
- **Permission tests asserting both what each role CAN and CANNOT do** — see rule below.
- RLS test proving cross-tenant and cross-practice isolation.
- Audit rows written and asserted.
- Timezone and date-format correctness verified against a non-UTC user.
- Responsive from 375px.
- Migration tested forward and backward against seeded data.
- Zero TypeScript errors, zero lint errors, no skipped tests.

**The permission-test rule.** For every new action, add a test row for every role that asserts the
negative case as well as the positive. The predecessor product shipped an activity logger that was
invisible to the only role that needed it, and every test passed. Negative assertions are how that
class of defect is caught. `tests/permissions` must fail if a role-action pair is untested.

## 6. Behaviour I expect from you

**Ask before assuming on business rules.** `docs/DECISIONS.md` lists open questions. If a task
depends on an unanswered one, stop and ask. Do not pick a plausible default and proceed silently.

**Prefer boring and explicit.** Clarity beats cleverness. No metaprogramming, no premature
abstraction, no dependency added without justification recorded in `docs/DECISIONS.md`.

**Never invent a metric formula.** All analytic definitions live in
`docs/04-metric-definitions.md`. If a metric you need is not defined there, stop and ask.

**Never weaken a guardrail to make a test pass.** If RLS or a permission check blocks you, the
check is probably right and your approach is probably wrong.

**Never generate seed or demo data that can reach production analytics.** Seed rows carry
`is_demo = true` and are excluded from every metric query by default.

**Say when something is a bad idea.** If a requirement in `/docs` is internally inconsistent,
technically unwise or will cause a data-integrity problem, say so instead of implementing it
faithfully and silently.

## 7. What NOT to build

Marketing automation and campaign execution. Support ticketing. Delivery and project execution.
Invoicing, billing and collections. Native mobile applications — responsive PWA only. Any AI
feature before Milestone 9; the data required to make them useful will not exist until then.

## 8. Session start checklist

1. Read this file.
2. Read `docs/DECISIONS.md` for newly answered or still-open questions.
3. Read the current milestone section of `docs/07-build-backlog.md`.
4. Confirm the specific task, restate its acceptance criteria, and state your plan before coding.
5. Ask about anything ambiguous **before** writing code.
