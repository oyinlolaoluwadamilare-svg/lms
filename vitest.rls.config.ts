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
  },
});
