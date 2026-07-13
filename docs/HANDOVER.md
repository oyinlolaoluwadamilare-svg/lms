# Engineering handover: Workforce Group CPMS

This document is for the engineers taking over deployment and operation of the
CPMS. Read `CLAUDE.md` first for the product brief and the engine rules that
must not change; read `README.md` for the quick start. This file covers what
they do not: how the system hangs together, what to connect, and what to watch.

## What you are receiving

A complete, launch-ready pilot. Every screen and workflow in the brief is
built, plus all nine AI features:

- Login and role-based access (`csst` admin, `lob` operator per unit, `emt` reviewer)
- Group dashboard with weighted scores and RAG, unit drill-down
- Operator workspace: monthly actuals with live attainment, notes, initiatives,
  what-is-missing list, draft/submit
- EMT review: queue, numbers-plus-narrative detail, sign off with rating or
  return with comment (full state machine: draft, submitted, approved, returned)
- Analytics: trend, target-versus-actual, RAG distribution, unit-by-perspective
  heatmap, run-rate projection, year-on-year (activates once a prior year has
  data), CSV export
- Administration: full CRUD for units (creating a unit creates its operator
  login), perspectives, objectives with key results, KPIs; targets editor with
  even/seasonal monthly phasing; paginated audit log
- Documents: private uploads to DigitalOcean Spaces via presigned URLs with
  inline PDF preview; per-unit logo upload
- AI: nine server-side assists grounded in engine-computed summaries

Verified state at handover: `npx vitest run` green (40 engine/format tests),
`npm run build` clean, and three Playwright journeys passing against the
production build (`scripts/e2e-operator.mjs`, `e2e-review.mjs`, `e2e-admin.mjs`).

## Architecture

```
Browser
  └─ Next.js 16 App Router (Vercel)
      ├─ src/proxy.ts            cheap signed-out redirect (NOT the security boundary)
      ├─ Server components       read via src/lib/dataset.ts -> loadDataset(year)
      │    └─ src/lib/engine.ts  pure scoring engine (rollups, attainment, RAG, weights)
      ├─ Server actions          src/actions/* (every action calls a session guard first)
      │    └─ src/lib/session.ts requireRole / requireUnitWrite / resolveActingUnit
      ├─ Route handlers
      │    ├─ /api/auth/[...all] Better Auth
      │    ├─ /api/export        CSV
      │    ├─ /api/documents/[id] presigned GET redirect
      │    └─ /api/ai/*          nine AI features (role-guarded, graceful degradation)
      ├─ Postgres (Neon in prod) via Drizzle; driver switch in src/db/index.ts
      ├─ DigitalOcean Spaces via src/lib/storage.ts (private objects, presigned URLs)
      └─ Anthropic API via src/lib/ai.ts (the only provider-aware file)
```

Key invariants (enforced by tests; do not break):

- The engine is pure: functions over one in-memory `Dataset`, no IO. All
  scoring rules live there and only there.
- Numeric coercion happens once, at the dataset boundary
  (`src/lib/dataset.ts`); the engine only ever sees numbers.
- Authorization is server-side in actions and loaders. The proxy redirect is
  UX, not security. Operators' unit ids are always derived from their profile,
  never trusted from the client.
- AI is human-in-the-loop: routes only ever return text; nothing AI-generated
  writes to the database. Grounding summaries come from engine output, never
  raw tables, never person-level data.
- No em dashes in code, UI copy, or AI output (house rule; the AI layer strips
  them defensively).

## Connect and set up (production)

Order matters only in that the database must exist before migrating.

1. **Neon (database)**
   - Create a project in an EU region (Frankfurt `eu-central-1` or London, for
     NDPA data-residency comfort).
   - Set `DATABASE_URL` to the pooled connection string. The code selects the
     Neon serverless driver automatically for `*.neon.tech` hosts
     (`DB_DRIVER=neon` forces it).
   - Run `npx drizzle-kit migrate` against it (locally with the env var set is
     fine). Migrations are checked in under `drizzle/`; never hand-edit the
     database.
   - Optionally `npm run seed` for the demo dataset, or start clean and build
     the scorecard through Administration.

2. **Vercel (app)**
   - Import the GitHub repo, framework preset Next.js, no special build config.
   - Environment variables (see `.env.example`): `DATABASE_URL`,
     `BETTER_AUTH_SECRET` (generate: `openssl rand -hex 32`),
     `BETTER_AUTH_URL` (the canonical production URL, e.g.
     `https://cpms.workforcegroup.com`), plus the optional groups below.
   - AI routes declare `maxDuration = 60`; on a Hobby plan either upgrade to
     Pro or lower the duration and `maxTokens` in `src/lib/ai.ts`.

3. **DigitalOcean Spaces (documents, optional at first)**
   - Private Space in `fra1`, `ams3`, or `lon1`. Generate a Spaces access key
     (Settings > Access Keys; this is not the DO API token).
   - Set `SPACES_KEY`, `SPACES_SECRET`, `SPACES_REGION`,
     `SPACES_ENDPOINT=https://<region>.digitaloceanspaces.com`,
     `SPACES_BUCKET`.
   - Keep the Space private. The app only ever issues short-lived presigned
     URLs; nothing is public.

4. **Anthropic (AI, optional at first)**
   - Set `ANTHROPIC_API_KEY`. Model is `AI_MODEL`, default `claude-sonnet-5`.
   - The Anthropic API does not train on API data by default, and the
     assistant only receives unit-level aggregates, which is the NDPA posture
     the brief requires.

Without steps 3 and 4 the app runs fully; those surfaces show clear
"not configured" states.

### First production login

The seed creates `csst@wfg.demo` / `wfg2026` and friends. For a real rollout:
seed, log in as CSST, create the real units (each creates its operator login
with the email/password you choose), set targets, then delete or ignore the
demo units, or skip the seed entirely and create everything through
Administration. Passwords are hashed by Better Auth (scrypt); there is no
password reset flow yet, so keep credentials in your vault (see gaps below).

## Operating notes

- **Migrations**: `npx drizzle-kit generate` after schema changes in
  `src/db/schema.ts`, commit the SQL in `drizzle/`, run `migrate` on deploy.
  Better Auth's tables live in `src/db/auth-schema.ts`; regenerate with
  `npx @better-auth/cli generate` if you change auth config, so drizzle-kit
  keeps one migration history.
- **Fiscal years**: the app reads the active row in `fiscal_years`. Opening
  FY 2027 means inserting the year and building targets for it (the seed shows
  the shape). Year-on-year analytics light up automatically.
- **Auditing**: every write lands in `audit_log` via `src/lib/audit.ts`.
  The audit screen is at `/admin/audit`.
- **Tests in CI**: `npx vitest run` needs no database. The Playwright scripts
  need a running app plus seeded Postgres; wire them post-deploy or against a
  preview if you add CI.

## Known gaps to close before wide rollout

Deliberately out of scope for the pilot, in rough priority order:

1. No password reset or change-password flow (Better Auth supports it; wire
   `forgetPassword`/`resetPassword` with an email provider).
2. No rate limiting on the AI routes beyond role checks; add per-user limits
   if keys/cost become a concern.
3. Authorization is server-action based per the confirmed decision; Postgres
   RLS can be layered on later without schema changes (policies would key on
   the Better Auth user id joined through `profiles`).
4. Email notifications (submission received, period returned) do not exist.
5. The seed is destructive (truncates all tables); never run it against a
   database with real data.

## Contacts in the code

Start reading here, in order: `src/lib/engine.ts` (the maths),
`src/lib/session.ts` (the security model), `src/lib/dataset.ts` (the data
boundary), `src/actions/submissions.ts` (the workflow state machine),
`src/lib/ai.ts` + `src/lib/summaries.ts` (the AI layer).
