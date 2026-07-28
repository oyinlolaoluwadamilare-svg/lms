import { expect, test } from "@playwright/test";

// M0.3 e2e coverage that doesn't require a live Supabase test user: routing/redirect behaviour
// and form rendering. Coverage of an actual successful sign-in, and of a real suspended user
// being denied, needs a seeded test account against a live Supabase project - there is no seed
// script until M0.8 (docs/07-build-backlog.md) and no local Supabase Auth stack in this repo yet,
// so that case is not faked here. See src/services/session.ts (unit-tested) for the logic that
// case exercises.

test("sign-in form renders with accessible labels", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("submitting the sign-in form with an empty email shows a server-validated error", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Email is required")).toBeVisible();
});

test("preserves the next path through sign-in for a deep link", async ({ page }) => {
  await page.goto("/some-protected-path");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fsome-protected-path/);
});

test("reset-password form renders and accepts a submission", async ({ page }) => {
  await page.goto("/reset-password");
  await page.getByLabel("Email").fill("someone@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
  // Generous timeout: this round-trips a real call to Supabase Auth's mail sender (free-tier
  // shared provider), not a mocked network layer - the call happens server-side inside the
  // Server Action, so page.route() can't intercept it from the browser context.
  await expect(page.getByRole("status")).toContainText(
    "If an account exists for that email, we've sent a link to reset your password.",
    { timeout: 15_000 },
  );
});

test("an expired or missing recovery link shows the expired state, never the password form", async ({
  page,
}) => {
  await page.goto("/update-password");
  await expect(page.getByText("invalid or has expired")).toBeVisible({ timeout: 5000 });
  await expect(page.getByLabel("New password")).toHaveCount(0);
});
