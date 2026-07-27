# 03 — Architecture and Conventions

## Layering, enforced by lint

```
app/          → services/ → data/ → domain/
                          ↘ auth/
ui/  (presentational only, no data fetching)
lib/ (pure helpers, importable anywhere)
```

`domain` is pure: no imports from `data`, `services`, `app`, `ui`, no database client, no fetch, no
framework. It contains the calculations and rules — probability, weighting, staleness banding,
qualification completeness, task state transitions — and is therefore trivially testable.

`data` holds every SQL statement in the codebase. One repository per aggregate. Repositories return
domain types, never raw rows.

`services` orchestrates: opens transactions, calls repositories, emits events, writes audit entries,
enqueues notifications. **All multi-table writes happen here, inside a transaction.**

`app` contains routes and server actions. It validates input with Zod, calls `can()`, calls a service,
and renders. It contains no business logic and no SQL.

## The single-path rule

Some operations must have exactly one implementation, because duplicated paths are how invariants
break. These are:

**`changeStage(dealId, toStageId, actor)`** — the only way a deal's stage changes. Called by the edit
form, the board drag, mark-won, mark-lost, bulk actions and the API. It writes the deal update, the
`stage_events` row, the audit entry and any triggered automation in one transaction. No caller
updates `deals.stage_id` directly, ever.

**`logActivity(input, actor)`** — the only way an activity is created, from manual entry, mail sync or
calendar sync. Guarantees the derived-field refresh and the audit row.

**`assignTask(taskId, assigneeId, actor)`** — the only way assignment changes, guaranteeing the
`task_assignments` ledger entry and the notification.

**`closeDeal(dealId, outcome, actor)`** — writes the outcome row, the stage event, the deal status,
the cancellation of open tasks and the audit entry atomically. Cannot succeed without an outcome reason.

## Transactions and events

Every state change is a transaction that includes its audit entry. If the audit write fails, the
business write rolls back — an unaudited change is worse than no change.

Domain events (`deal.stage_changed`, `activity.logged`, `task.assigned`, `task.overdue`,
`deal.closed`) are emitted after commit and consumed by notification and automation handlers.
Handlers are idempotent and keyed on the event id, so a retry never double-fires a rule or
double-sends a notification.

## API conventions

Server actions for interactive mutations; route handlers for the public API. Every endpoint validates
with Zod at the boundary and returns a discriminated result rather than throwing across the boundary.
Errors carry a stable machine code plus a human message. Money is always an object of
`{ amountMinor: number, currency: string }` — never a bare number. Dates that represent a real-world
day (`activity_date`, `due_date`, `expected_close_date`) are `YYYY-MM-DD` strings, never timestamps,
because a day is not an instant. Instants (`created_at`, `occurred_at`) are ISO 8601 UTC.

Pagination is cursor-based with a stable sort. List responses include `totalCount` only when cheap.

## Money

`bigint` minor units plus a currency code, everywhere. No floats, no client-side arithmetic on
formatted strings. Conversion happens in one place using `fx_rates`, with open pipeline at current
rate and closed deals locked at the close-date rate. Formatting is a presentation concern using
`Intl.NumberFormat` with the user's locale.

## Dates and time

Store instants as `timestamptz` in UTC. Store real-world days as `date`. Never use a timestamp for a
day, and never apply a timezone conversion to a `date`. Render in the user's timezone, falling back to
the tenant timezone, falling back to Africa/Lagos. All "today", "overdue" and "due this week"
calculations resolve in the user's timezone, not the server's.

## Error handling and observability

No silent catch. Structured JSON logs with request id, tenant id, actor id, action and duration — and
never personal data, email bodies or note contents. Permission denials are logged at warn level with
the attempted action, because a spike is a signal. Every automation firing writes an
`automation_runs` row so behaviour is explainable from the affected record.

## Performance budgets

Deal detail with 100 activities: under 1.5s at p95. My Work with 200 open tasks: under 1s. Analytics
over 100k stage events: under 3s. Board view with 500 deals: under 2s. Derived fields are maintained
on write, so no list view ever computes staleness across the table at read time. Index every foreign
key used in a filter; the schema file already declares the partial indexes that matter.

## Security

Server-side authorisation on every path via `can()`, with RLS as an independent second control.
OAuth tokens encrypted at rest, held server-side only, never serialised to a client component.
No secrets in the client bundle. Rate limit authentication and public API endpoints. Hash any IP
stored in the audit trail. Content Security Policy set, no inline scripts. Signed, expiring URLs for
document downloads scoped to the requesting user's entitlement.

## Accessibility and UI conventions

WCAG 2.1 AA. Every interactive element keyboard reachable with a visible focus ring. Forms use real
labels, not placeholders as labels. Errors announced to assistive technology. Colour never the sole
carrier of meaning — the staleness bands pair colour with a number. Design tokens only, no inline hex
in components. Every list has a designed empty state that tells the user what to do next, not merely
that there is nothing there.
