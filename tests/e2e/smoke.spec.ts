import { expect, test } from "@playwright/test";

// M0.1 scaffold smoke test only. The first real e2e journey (per-role primary
// path) lands with its owning milestone in docs/07-build-backlog.md.
test("app shell renders", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Pipeline Intelligence");
  await expect(page.locator("body")).toContainText("scaffold (M0.1)");
});
