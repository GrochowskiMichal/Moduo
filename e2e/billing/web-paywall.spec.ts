/**
 * web-paywall.spec.ts
 *
 * Verifies the web app subscription gate:
 * - Unauthenticated users accessing the root are redirected (to /auth or /paywall).
 * - The /paywall route itself is not behind auth (publicly reachable).
 * - The /auth route is accessible for sign-in / sign-up flows.
 */

import { expect, test } from "@playwright/test";
import { BASE_URL } from "./helpers";

test.describe("Web paywall (SubscriptionGate)", () => {
  test("/ redirects unauthenticated user away from dashboard", async ({ page }) => {
    const response = await page.goto(BASE_URL, { waitUntil: "networkidle" });
    // A redirect occurred, meaning the raw "/" was not returned.
    const finalUrl = page.url();
    expect(finalUrl).not.toBe(`${BASE_URL}/`);
  });

  test("/paywall is publicly accessible without auth", async ({ page }) => {
    const response = await page.goto(`${BASE_URL}/paywall`);
    expect(response?.status()).toBeLessThan(400);
    await expect(page.getByText("Pro")).toBeVisible({ timeout: 8_000 });
  });

  test("/auth is reachable for unauthenticated users", async ({ page }) => {
    const response = await page.goto(`${BASE_URL}/auth`);
    expect(response?.status()).toBeLessThan(400);
    // Email input should appear on the auth page.
    await expect(page.getByRole("textbox", { name: /email/i }).first()).toBeVisible({
      timeout: 8_000,
    });
  });

  test("/paywall contains pricing information", async ({ page }) => {
    await page.goto(`${BASE_URL}/paywall`);
    // At least one dollar-sign price should be visible.
    await expect(page.locator("text=$").first()).toBeVisible();
  });
});
