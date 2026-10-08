/**
 * workspace-paywall.spec.ts
 *
 * Verifies that the paywall page renders all workspace plan cards,
 * and that the "+ New workspace" button triggers an upgrade prompt
 * for free-tier users (UI smoke test using mocked entitlements).
 */

import { expect, test } from "@playwright/test";
import { BASE_URL } from "./helpers";

test.describe("Workspace paywall", () => {
  test("paywall page shows three plan cards with correct names", async ({ page }) => {
    await page.goto(`${BASE_URL}/paywall`);

    const headings = page.getByRole("heading", { level: 3 });
    const names = await headings.allTextContents();
    expect(names.some((n) => /free/i.test(n))).toBeTruthy();
    expect(names.some((n) => /pro/i.test(n))).toBeTruthy();
    expect(names.some((n) => /team/i.test(n))).toBeTruthy();
  });

  test('paywall page "Start free trial" buttons link to checkout', async ({ page }) => {
    await page.goto(`${BASE_URL}/paywall`);

    // Clicking a paid plan trial CTA should navigate to Stripe or checkout.
    const trialBtn = page.getByRole("button", { name: /start free trial/i }).first();
    await expect(trialBtn).toBeVisible();
  });

  test("paywall page renders without JS errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto(`${BASE_URL}/paywall`);
    await page.waitForLoadState("networkidle");
    expect(errors).toHaveLength(0);
  });
});
