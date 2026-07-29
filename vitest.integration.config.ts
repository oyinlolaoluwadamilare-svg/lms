import { defineConfig } from "vitest/config";
import path from "node:path";

// Separate from vitest.config.ts because src/data repositories are built on the Supabase JS
// client (PostgREST), not a raw Postgres connection - unlike tests/rls, which only needs bare
// Postgres, these need a real PostgREST layer. This container has no Docker daemon (no local
// Supabase stack via `supabase start`), so these run against the real hosted project
// (NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY) rather than anything local. Each spec
// creates and tears down its own dedicated tenant - never touches db/seed's demo tenants.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.spec.ts"],
    testTimeout: 30_000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
