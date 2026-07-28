import { defineConfig } from "vitest/config";

// Separate from vitest.config.ts because these tests need a live Postgres (docs/05-test-strategy.md:
// "RLS | SQL harness | Database-level isolation with the app bypassed"). Not part of `npm run test`
// so the fast unit/permission/layering suites stay dependency-free; run explicitly via
// `npm run test:rls` once a Postgres is available (see tests/rls/README.md).
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/rls/**/*.spec.ts"],
    testTimeout: 20_000,
    // Every spec file's seed() truncates shared tables (tenants/practice_lines/users/user_roles)
    // against the same physical local Postgres - concurrent TRUNCATE CASCADE across files
    // deadlocks (seen firsthand adding a third spec file: two ran fine together, three didn't).
    // These files were never designed for cross-file isolation, only within-file idempotency.
    fileParallelism: false,
  },
});
