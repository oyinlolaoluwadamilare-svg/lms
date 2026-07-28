# 09 — Non-Functional Requirements

## Security

Authorisation is enforced server-side on every path via `can()`, with RLS as an independent second
control. Interface-level hiding is presentation only and never the sole gate.

Every tenant-scoped table has RLS enabled. A table without RLS does not ship. Cross-tenant access is
impossible for every role including `tenant_admin`.

The `executive` role is granted select only, at the database level. Read-only must be true even if
every line of application code were bypassed.

OAuth tokens for mail connectors are encrypted at rest, held server-side, and never serialised into a
client component or a log line. OAuth is always initiated by the mailbox owner; no code path allows
connecting another user's mailbox.

No self-service account creation. Users exist by invitation within the tenant seat cap. Passwords are
never handled by anything other than Supabase Auth's own flows.

Rate limiting on authentication, password reset and all public API endpoints. Content Security Policy
set with no inline scripts. Document downloads use signed, expiring URLs scoped to the requesting
user's entitlement.

Audit entries are append-only, enforced by trigger, and include a hashed IP. Permission denials are
logged at warn level, because a spike is a security signal.

## Privacy and data protection

Email body storage is off by default; metadata plus an optional excerpt only, with per-thread
exclusion available to the user and a tenant-level override. Confirmed by decision D-07.

No personal data in URLs, query strings, referrers or log lines. Note contents and email bodies are
never logged.

Contact and stakeholder handling must support export and erasure of an individual's personal data on
request, per applicable data-protection law in each operating jurisdiction.

Demo and seed rows carry `is_demo = true` and are excluded from every metric query, with a CI
assertion proving it.

## Reliability

Every state change is transactional and includes its own audit write. If the audit insert fails, the
business write rolls back.

Domain events are emitted after commit. Handlers are idempotent, keyed on event id, and retried with
exponential backoff. No automation rule fires twice for one trigger instance; no notification is
delivered twice.

Mail and calendar synchronisation degrade gracefully. A sync outage must never block manual logging.

Migrations are reversible and tested forward and backward against seeded data before merge.

Backups run daily with 30-day retention on encrypted storage. Restore is an out-of-band operation
requiring platform-level authorisation; tenant admins may request but not execute it.

## Performance budgets, enforced in CI

| Surface | Budget |
|---|---|
| Deal detail, 100 activities | under 1.5s at p95 |
| My Work, 200 open tasks | under 1s |
| Pipeline board, 500 deals | under 2s |
| Analytics over 100k stage events | under 3s |
| Log Activity save round trip | under 500ms |

Derived fields are maintained transactionally on write. No list view computes staleness across the
table at read time. Every foreign key used in a filter is indexed.

## Correctness of time and money

Instants stored as `timestamptz` in UTC; real-world days stored as `date`. A day is never a
timestamp and a `date` is never timezone-converted.

All "today", "overdue" and "due this week" logic resolves in the user's timezone, falling back to the
tenant timezone, falling back to Africa/Lagos.

`activity_date` and `created_at` are distinct in the schema, in every API response, in every export
and in the interface. Conflating them is a bug.

Money is `bigint` minor units plus a currency code. No floats. Conversion happens in exactly one
place; open pipeline at current rate, closed deals locked at the close-date rate.

## Accessibility

WCAG 2.1 AA on every screen, verified by axe in the Playwright suite with zero serious violations.
Full keyboard reachability with visible focus. Real labels, not placeholders. Errors announced to
assistive technology. Colour never the sole carrier of meaning — staleness pairs colour with a number.

## Usability constraints treated as requirements

Logging an engagement: three interactions maximum from the deal page. Creating a task: three
interactions maximum. My Work and Log Activity fully usable at 375px, since field logging is where
adoption is won or lost. Every list has a designed empty state that states the next useful action.

## Observability

Structured JSON logs carrying request id, tenant id, actor id, action and duration — never personal
data. Every automation firing writes an `automation_runs` row traceable from the affected record.
Product analytics instrumented against the success metrics in the product brief from day one, so
adoption is measured rather than reconstructed later.

## Threat notes

The three most likely serious failures in this product, in order: a permission or RLS gap exposing one
tenant's or practice's data to another; a migration or merge operation silently combining two distinct
client entities; and token mishandling in the mail connectors exposing correspondence. Each deserves
adversarial review rather than happy-path testing, and each is called out as a ⚑ gate in the backlog.
