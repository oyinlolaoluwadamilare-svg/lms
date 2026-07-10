@AGENTS.md

# CLAUDE.md: Workforce Group CPMS

This is the working brief for the Corporate Performance Management System (CPMS).
Read it before touching the code.

## The product in one paragraph

CPMS is an internal web application for Workforce Group (WFG), a Nigerian
human-capital and consulting firm with seven lines of business. It takes the
group's strategy, breaks it down into objectives and measurable KPIs for each
business unit, lets each unit enter its actual results month by month, rolls
those results up automatically into weighted scores with a red/amber/green
status, and gives the executive team a single live picture of how the whole
group is performing against plan, plus a formal review and sign-off step.

## Confirmed build decisions (this codebase)

- Next.js 16 App Router, React 19, TypeScript, Tailwind v4 (tokens in
  `src/app/globals.css` under `@theme`), hand-vendored shadcn-style primitives
  in `src/components/ui`.
- Database: Postgres via Drizzle ORM. Local dev runs PostgreSQL 16 in the
  container; production is Neon. `src/db/index.ts` switches driver by
  `DATABASE_URL` (node-postgres locally, Neon serverless on Neon). Migrations
  are version-controlled in `drizzle/`.
- Auth: Better Auth, self-hosted, email + password. Users and sessions live in
  our own Postgres, so the identity layer moves to Neon unchanged. The
  `profiles` table maps the auth user id to a role (`csst` | `emt` | `lob`)
  and, for operators, a unit id.
- Authorization: enforced in server actions and data loaders via
  `src/lib/session.ts` (`requireRole`, `requireUnitAccess`). Never UI-only.
  Note: Next 16 renamed middleware to `src/proxy.ts`; it does only the cheap
  session-cookie redirect and is not the security boundary.
- Storage: DigitalOcean Spaces behind `src/lib/storage.ts` (AWS S3 SDK,
  private objects, presigned URLs). Degrades gracefully when `SPACES_*` env
  vars are unset.
- AI: Anthropic behind `src/lib/ai.ts` only. Model from `AI_MODEL` env,
  default claude-sonnet-5. Grounded strictly in engine-computed summaries
  built by `src/lib/summaries.ts`. Degrades to a clear "not configured" state
  without `ANTHROPIC_API_KEY`.

## The mental model

1. Strategy cascades: group objective -> unit objective -> KPI -> target ->
   actual.
2. Time is monthly at the bottom and rolls up. Units enter actuals one month
   at a time; the app computes quarter, half, and year using the correct
   method per KPI.
3. Everything becomes a score with a colour. Attainment percentage maps to
   red/amber/green; KPIs roll up by weight into a unit score, units roll up by
   weight into a group score.
4. Numbers are owned, then reviewed. Operators submit a period; the EMT signs
   off or returns it.

## Roles

- `csst` (Corporate Strategy Support Team): administrators. Own definitions
  (units, perspectives, objectives, KPIs, targets). See everything.
- `lob` (unit MD / LOB lead): operators, scoped to one unit. Set their unit's
  targets, enter monthly actuals, write the reporting note, submit periods.
- `emt` (Executive Management Team): reviewers. Read everything, approve or
  return submitted periods with a rating and comment. No editing definitions,
  no entering actuals.

## Engine rules (invariants, do not break)

- Roll up each KPI by its own aggregation method: sum, average, or period-end.
  Never sum a rate.
- Attainment respects direction; for lower-is-better KPIs, under target is
  good (inverted maths).
- RAG: green at or above 100 percent, amber from 80 up to 100, red below 80.
- Unit score is weighted across its KPIs; group score is weighted across
  units. Weights renormalise over scored KPIs so missing data never silently
  deflates a score.
- One-off KPIs and initiatives are scored on achievement, not periodic totals.
- Authorisation lives in the server actions and data loaders, never only in
  the UI.
- The engine (`src/lib/engine.ts`) stays pure: functions over a single
  in-memory Dataset object, fully covered by vitest.

## AI: core requirement, not an add-on

Nine features, all server-side route handlers under `src/app/api/ai/`:
suggest KPIs (admin), suggest corrective initiatives (report), period insight
(analytics), narrative draft (submit), executive summary (review), variance
and anomaly detection (analytics), run-rate projection (analytics),
ask-the-data (analytics), review assistance (review detail).

Non-negotiables: human-in-the-loop always (the model proposes, a person
decides, only explicit actions write through the normal role-checked path);
grounded only in the compact engine-computed summary, never invented figures;
separate fact from recommendation; no em dashes in output; provider-abstracted
behind `src/lib/ai.ts`; graceful "not configured" state without a key. The
assistant receives unit-level aggregates, never individual staff records.

## Look and feel

Palette: Deep Navy #003170, Mid Blue #4087C7, Sky Blue #5FBBFF, Charcoal
#1C1C1C. Font is Open Sans. No gold or orange. Login sits on the navy header;
dashboards use a light surface. RAG is never colour alone: always paired with
a label or icon, colour-blind-safe tones, WCAG AA contrast. Executives read
dashboards on phones; operators do data entry on desktop.

## House rules

- No em dashes anywhere: code, UI copy, or AI output.
- Ground product copy and examples in Nigerian and pan-African reality. Show
  Naira where money appears.
- Prefer honest assessments over reassurance.

## Local development

```bash
sudo pg_ctlcluster 16 main start   # local Postgres 16
npm install
npx drizzle-kit migrate            # apply migrations in drizzle/
npm run seed                       # demo users + dataset (password wfg2026)
npm run dev
npx vitest run                     # engine tests
```

Demo logins after seeding, password `wfg2026`: `csst@wfg.demo` (Admin),
`emt@wfg.demo` (Reviewer), and one operator per unit such as
`consulting@wfg.demo`.

## Environment variables

See `.env.example`. `DATABASE_URL` (Neon or local Postgres),
`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, optional `SPACES_KEY`,
`SPACES_SECRET`, `SPACES_REGION`, `SPACES_ENDPOINT`, `SPACES_BUCKET`,
optional `ANTHROPIC_API_KEY` and `AI_MODEL`.

## Deployment (linking later)

Push to GitHub, import into Vercel, set env vars, deploy. Provision Neon
(European region such as Frankfurt or London for NDPA residency), point
`DATABASE_URL` at it, run migrations and seed. Create a private DigitalOcean
Space in fra1/ams3/lon1 and set the `SPACES_*` vars. Set `ANTHROPIC_API_KEY`
to enable the AI features.
