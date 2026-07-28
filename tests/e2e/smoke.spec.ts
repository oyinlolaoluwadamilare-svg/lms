import { expect, test } from "@playwright/test";

// M0.3 supersedes the M0.1 scaffold assertion: "/" now requires an active session (see
// src/services/session.ts), so an unauthenticated visit redirects to sign-in rather than
// rendering the placeholder directly.
test("unauthenticated visit to the app shell redirects to sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page).toHaveTitle("Pipeline Intelligence");
});
