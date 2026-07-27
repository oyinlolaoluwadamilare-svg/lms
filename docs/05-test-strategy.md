# 05 — Test Strategy

## Principle

The predecessor product had a feature that was fully built, fully tested, and completely unusable by
the role that needed it, because the tests only asserted what roles *could* do. This strategy is
designed so that class of failure is structurally impossible.

## Layers

| Layer | Tool | Covers | Bar |
|---|---|---|---|
| Unit | Vitest | `src/domain` pure logic: probability, weighting, staleness bands, completeness, date maths | 90% line coverage on `domain`, no I/O |
| Integration | Vitest + test Postgres | Repositories, triggers, derived fields, constraint violations | Every invariant in `01-domain-model.md` has a test |
| **Permissions** | Vitest | Every role-action pair, allow **and** deny | **Suite fails if any pair is untested** |
| **RLS** | SQL harness | Database-level isolation with the app bypassed | Every tenant-scoped table |
| E2E | Playwright | Primary journeys per role | Each milestone's headline flow |
| Accessibility | axe in Playwright | WCAG 2.1 AA on every new screen | Zero serious violations |
| Performance | k6 or Playwright traces | The NFR budgets | Enforced in CI on the seeded dataset |

## The permission suite

Generated from `docs/02-permission-matrix.md`. Structure:

```ts
const ROLES = ['bdm','team_lead','director','executive','tenant_admin'] as const;
const ACTIONS = [...] as const;   // every action string from the matrix

it('every role-action pair is covered', () => {
  for (const r of ROLES) for (const a of ACTIONS)
    expect(MATRIX[r]?.[a], \`UNTESTED PAIR: \${r}/\${a}\`).toBeDefined();
});
```

Mandatory named cases:
- `bdm can create an activity on a deal they own` — the predecessor's exact defect.
- `bdm can create an activity on a deal they co-own`.
- `bdm can assign a task to a practice-line peer`.
- `executive cannot write to any table, for every write action`.
- `no role can delete an activity`.
- `no role can update an audit entry or a stage event`.
- `no role can connect another user's mailbox`.
- `a suspended user is denied every action despite holding role rows`.
- `tenant A cannot read any row belonging to tenant B, for every table`.

## The RLS harness

Connects as each role's real database identity, bypassing all application code, and asserts:
cross-tenant select returns zero rows on every table; a BDM identity cannot update a deal outside
their entitlement; the executive identity fails on insert, update and delete everywhere; update and
delete on `stage_events` and `audit_entries` raise; an activity update outside the 24-hour window
affects zero rows; `activities` has no delete policy at all.

**Rule:** adding a table without a corresponding RLS test file fails CI.

## Invariant tests worth naming

An active deal cannot be saved without an owner and expected close date. An activity cannot be dated
in the future. Retraction without a reason fails. A blocked task without a reason fails. A deal
cannot have two primary contacts. A tenant cannot have two won stages. Marking a deal won without an
outcome row rolls back the whole transaction. Inserting a client-facing activity updates
`last_engaged_at` within the same transaction. Completing the earliest open task recomputes
`next_action_task_id`. A stage change writes exactly one `stage_events` row regardless of which
code path triggered it.

## Time and locale tests

Every date-sensitive test runs against a user in Africa/Lagos **and** a user in a negative-offset
timezone. Assert that: an activity logged at 23:30 WAT shows the correct local date; a task due
"today" resolves in the user's timezone, not the server's; `activity_date` and `created_at` are
never conflated in any response; DD/MM/YYYY and MM/DD/YYYY both render correctly.

## Seed data

Deterministic, generated from a fixed seed, all rows carrying `is_demo = true`. Must include: two
tenants for isolation testing; seven practice lines; users covering every role including one
suspended; deals distributed across all stages including won and lost; deals deliberately in every
staleness band; at least one deal with no owner to exercise the remediation queue; one deal with a
stage regression; activities spanning eighteen months to make cohort metrics meaningful; tasks that
are open, overdue, blocked, completed on time and completed late; multi-contact deals with all
decision roles; single-threaded deals to trigger the risk warning.

**Assert in CI that no demo row appears in any metric query result.**

## Definition of done, restated

No item is complete without: acceptance criteria met; unit tests on domain logic; integration tests
on repositories and triggers; permission tests for allow and deny across all roles; an RLS test;
audit rows asserted; timezone verification; 375px responsive check; forward and backward migration
test; zero type and lint errors; no skipped tests.
