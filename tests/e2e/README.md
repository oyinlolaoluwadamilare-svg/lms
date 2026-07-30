# E2E tests (Playwright)

Most of this suite (`smoke.spec.ts`, most of `auth.spec.ts`) needs nothing beyond the app itself -
routing, redirects, form rendering and client-side validation. Two things are the exception, and
both need a real, live Supabase project:

- `auth.spec.ts`'s reset-password test makes a real call to Supabase Auth's mail sender.
- `pipeline.spec.ts` (M1.4) signs in as a real seeded demo user (`db/seed/seed.mjs`) and checks the
  pipeline table view renders correctly for their role.

## Running locally

```
npm run db:seed   # only needed once per project, or after wiping the demo tenants
npm run test:e2e
```

Requires `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` in `.env.local` (the same ones everything else in this repo uses;
`db:seed` needs the service-role key, the running app needs the other two).

## Running in CI

The `e2e` job in `.github/workflows/ci.yml` needs three repository secrets configured (Settings ->
Secrets and variables -> Actions): `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY`. This was a pre-existing gap in the job (the reset-password test
already needed live credentials it was never given) that M1.4 made impossible to keep deferring,
since `pipeline.spec.ts` also needs a seeded, signed-in session. **This job fails until those
secrets exist** - an intentional, visible signal rather than a job that silently skips itself, same
as the `integration` job's own note in `tests/integration/README.md`.
