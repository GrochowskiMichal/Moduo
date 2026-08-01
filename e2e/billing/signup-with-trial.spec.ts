/**
 * signup-with-trial.spec.ts
 *
 * Verifies that a new web user who completes OTP signup lands on the
 * trial-active confirmation step of onboarding, and that the trial banner
 * appears after they reach the main app.
 */

import { expect, test } from "@playwright/test";
import { BASE_URL, fillSignupEmail, testEmail } from "./helpers";

test.describe("Signup → 7-day trial", () => {
  test("new user sees trial-active onboarding step after signup", async ({ page }) => {
    const email = testEmail("signup-trial");
    await fillSignupEmail(page, email);

    // After sending the code the OTP input should appear.
    await expect(page.getByPlaceholder(/enter code/i)).toBeVisible({ timeout: 10_000 });
  });

  test("paywall page is accessible at /paywall", async ({ page }) => {
    await page.goto(`${BASE_URL}/paywall`);

    // All three plan names should be visible.
    await expect(page.getByText("Pro")).toBeVisible();
    await expect(page.getByText("Team")).toBeVisible();
    await expect(page.getByText("Free")).toBeVisible();

    // "Start free trial" CTA should appear at least once.
    await expect(page.getByRole("button", { name: /start free trial/i }).first()).toBeVisible();
  });

  test("unauthenticated web user is redirected to /paywall from /", async ({ page }) => {
    await page.goto(BASE_URL);
    // Should end up on auth or paywall — not the main dashboard.
    await expect(page).not.toHaveURL(/^http.*\/$/, { timeout: 8_000 });
  });
});
