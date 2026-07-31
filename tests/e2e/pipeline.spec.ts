import { expect, test } from "@playwright/test";

// M1.4/M1.5 e2e coverage against a real seeded account (db/seed/seed.mjs, available since M0.8) -
// the primary path CLAUDE.md's Definition of Done asks for. The seeded acme-demo tenant has no
// pipeline_stages or accounts rows (M0.8 predates M1.1's deals migration - see db/seed/README.md),
// so this exercises the page's real empty-filter-options / zero-deals path rather than a populated
// table or board; the populated/filtered-table path and changeStage itself (including a real drag,
// manually verified against the actual running app and screenshotted during development) are
// proven end to end against real data in tests/integration/pipeline-list.spec.ts, which this
// container's Playwright cannot substitute for since browser tests here don't carry Supabase
// service-role credentials.

test.describe.configure({ mode: "serial" });

test("a bde signs in and sees the pipeline table view with its own practice's deals (none seeded yet)", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("bde-1@acme-demo.test");
  await page.getByLabel("Password").fill("Demo-Password-1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));

  await page.goto("/deals");
  await expect(page.getByRole("heading", { name: "Pipeline" })).toBeVisible();
  // Two "New deal" links legitimately co-exist here: the header action and the EmptyState's own
  // action (visible because there are zero deals and no filter is applied) - see PipelineTable.tsx.
  await expect(page.getByRole("link", { name: "New deal" }).first()).toBeVisible();

  // Filter form renders even with empty option lists (no pipeline_stages/accounts seeded yet).
  await expect(page.getByLabel("Stage")).toBeVisible();
  await expect(page.getByLabel("Owner")).toBeVisible();
  await expect(page.getByLabel("Status")).toBeVisible();

  await expect(page.getByText("No deals to show yet")).toBeVisible();
});

test("an executive sees the pipeline read-only (no New deal action) and can apply a filter", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("executive@acme-demo.test");
  await page.getByLabel("Password").fill("Demo-Password-1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));

  await page.goto("/deals");
  await expect(page.getByRole("heading", { name: "Pipeline" })).toBeVisible();
  await expect(page.getByRole("link", { name: "New deal" })).toHaveCount(0);

  await page.getByLabel("Status").selectOption("won");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/status=won/);
  await expect(page.getByText("No deals match these filters")).toBeVisible();
});

test("the board view toggle renders and preserves filters when switching", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("bde-1@acme-demo.test");
  await page.getByLabel("Password").fill("Demo-Password-1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));

  await page.goto("/deals?status=active");
  await page.getByRole("link", { name: "Board" }).click();
  await expect(page).toHaveURL(/view=board/);
  await expect(page).toHaveURL(/status=active/);
  // Zero deals either way (see file header) - board falls back to the same EmptyState as table.
  await expect(page.getByText("No deals match these filters")).toBeVisible();

  await page.getByRole("link", { name: "Table" }).click();
  await expect(page).toHaveURL(/status=active/);
  await expect(page).not.toHaveURL(/view=board/);
});
