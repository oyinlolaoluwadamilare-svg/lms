# Workforce Group CPMS

The Corporate Performance Management System for Workforce Group: the group's
strategy broken into objectives and measurable KPIs per business unit, monthly
actuals entered by each unit, automatic weighted roll-ups with red/amber/green
status, a formal EMT review and sign-off step, and an AI analyst grounded in
the computed scorecard. It replaces the spreadsheets and slide decks this
reporting used to live in.

Built with Next.js 16 (App Router), React 19, TypeScript, Tailwind v4,
Drizzle ORM on Postgres, Better Auth, Recharts, the AWS S3 SDK (DigitalOcean
Spaces), and the Anthropic API. See `CLAUDE.md` for the full product brief and
engine invariants.

## Quick start (local)

Requires Node 20+ and PostgreSQL 16.

```bash
# 1. Database
sudo pg_ctlcluster 16 main start
sudo -u postgres psql -c "CREATE USER cpms WITH PASSWORD 'cpms' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE cpms OWNER cpms;"

# 2. Environment
cp .env.example .env.local
# set DATABASE_URL=postgres://cpms:cpms@localhost:5432/cpms
# set BETTER_AUTH_SECRET to the output of: openssl rand -hex 32
# set BETTER_AUTH_URL=http://localhost:3000

# 3. Install, migrate, seed, run
npm install
npx drizzle-kit migrate
npm run seed
npm run dev
```

Demo logins after seeding, password `wfg2026`:

| Email | Role |
|---|---|
| `csst@wfg.demo` | Admin (Corporate Strategy Support Team) |
| `emt@wfg.demo` | Reviewer (Executive Management Team) |
| `consulting@wfg.demo`, `outsourcing@`, `resourcing@`, `learning@`, `energies@`, `africa@`, `zone@wfg.demo` | Operator, one per unit |

## Tests

```bash
npx vitest run          # 40 engine and formatting tests
node scripts/e2e-operator.mjs   # operator journey (needs the app running + seeded db)
node scripts/e2e-review.mjs     # submit -> return -> resubmit -> sign off
node scripts/e2e-admin.mjs      # create unit + login, objective, KPI, targets, audit
```

The E2E scripts drive a real Chromium via Playwright and mutate data; re-run
`npm run seed` afterwards to restore the pristine demo dataset.

## What degrades gracefully

The app always builds, deploys, and runs with only `DATABASE_URL` and the
Better Auth variables set:

- **AI** (`ANTHROPIC_API_KEY` unset): all nine assist panels render a clear
  "not configured" card. Set the key to enable them. Model comes from
  `AI_MODEL`, default `claude-sonnet-5`.
- **File storage** (`SPACES_*` unset): the Documents screen and logo upload
  show a "storage not configured" notice; nothing errors.

## Going to production (the linking runbook)

1. **Neon**: create a project in a European region (Frankfurt or London for
   NDPA residency). Point `DATABASE_URL` at the Neon connection string; the
   driver switches to Neon serverless automatically for `*.neon.tech` URLs
   (or force with `DB_DRIVER=neon`). Run `npx drizzle-kit migrate`, then
   `npm run seed` once if you want the demo dataset.
2. **Vercel**: import the repo, set the environment variables from
   `.env.example` (`BETTER_AUTH_URL` becomes your production URL), deploy.
   The AI routes set `maxDuration = 60`; on a Hobby plan they may need a
   shorter limit or a Pro plan.
3. **DigitalOcean Spaces**: create a private Space in `fra1`, `ams3`, or
   `lon1`. Generate a Spaces access key and set `SPACES_KEY`,
   `SPACES_SECRET`, `SPACES_REGION`, `SPACES_ENDPOINT`
   (`https://<region>.digitaloceanspaces.com`), `SPACES_BUCKET`. Objects stay
   private; the app serves them through short-lived presigned URLs only.
4. **Anthropic**: set `ANTHROPIC_API_KEY` to switch the nine AI features on.

## Architecture in one breath

Server components read via `src/lib/dataset.ts` (one Dataset per fiscal year),
the pure engine in `src/lib/engine.ts` computes every roll-up, attainment,
RAG, and score (vitest-covered, never touched by IO), mutations go through
role-checked server actions in `src/actions/`, authorization lives in
`src/lib/session.ts` (the proxy redirect is not the security boundary), and
the AI features are route handlers under `src/app/api/ai/` grounded in
`src/lib/summaries.ts` and provider-abstracted behind `src/lib/ai.ts`.
