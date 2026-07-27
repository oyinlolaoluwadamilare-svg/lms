import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.spec.ts", "tests/permissions/**/*.spec.ts", "tests/layering/**/*.spec.ts"],
    // Coverage on src/domain is enforced at 90% lines (docs/05-test-strategy.md) once domain
    // logic lands in M1+; not configured here because the folder is intentionally empty in M0.1.
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
