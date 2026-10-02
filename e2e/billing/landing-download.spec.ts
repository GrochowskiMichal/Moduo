/**
 * landing-download.spec.ts
 *
 * Verifies the moduo_landing Pricing component's free-tier CTA behaviour.
 * Tests run against the landing dev server (default: http://localhost:3000).
 *
 * Set E2E_LANDING_URL to point at a running landing instance.
 */

import { expect, test } from "@playwright/test";

const LANDING_URL = process.env.E2E_LANDING_URL ?? "http://localhost:3000";

test.describe("Landing free-tier download CTA", () => {
  test("Pricing section renders a download button for the Free plan", async ({ page }) => {
    await page.goto(`${LANDING_URL}/#pricing`);

    // The Free plan card should have a "Download for …" button (not a signup link).
    const downloadBtn = page.getByRole("button", { name: /download for/i });
    await expect(downloadBtn).toBeVisible({ timeout: 10_000 });
  });

  test("Download button links to /download/<os>", async ({ page }) => {
    const navigations: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url());
    });

    await page.goto(`${LANDING_URL}/#pricing`);

    const downloadBtn = page.getByRole("button", { name: /download for/i });
    await expect(downloadBtn).toBeVisible({ timeout: 10_000 });
    await downloadBtn.click();

    // After click the URL should include /download/
    const finalUrl = page.url();
    expect(finalUrl).toMatch(/\/download\/(mac|windows|linux)/);
  });

  test("#founders-interest section exists on the landing page", async ({ page }) => {
    await page.goto(`${LANDING_URL}/#founders-interest`);

    // The founders interest form should be present.
    await expect(page.getByPlaceholder(/your@startup\.com/i)).toBeVisible({ timeout: 10_000 });
  });

  test("founders interest form submits successfully (happy path)", async ({ page }) => {
    await page.goto(`${LANDING_URL}/#founders-interest`);

    const email = `e2e-founders-${Date.now()}@mailinator.com`;
    await page.getByPlaceholder(/your@startup\.com/i).fill(email);
    await page.getByPlaceholder(/tell us what you're building/i).fill("E2E test submission");
    await page.getByRole("button", { name: /get in touch/i }).click();

    // Success state shows a thank-you message.
    await expect(page.getByText(/thanks.*in touch/i)).toBeVisible({ timeout: 8_000 });
  });
});
