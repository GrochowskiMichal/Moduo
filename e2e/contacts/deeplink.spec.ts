/**
 * deeplink.spec.ts — fix pack FX-1, AC1 (URL-held selection).
 *
 * Drives the live app: navigating straight to /contacts?type=contact&id=X
 * opens X's hub; a reload keeps the selection; selecting a different row
 * updates the URL. Manual/local: needs the app running + a seeded contact.
 * NOT part of `bun run verify` (e2e stays local — gotchas.md). Skips unless
 * E2E_APP_URL is set.
 *
 * Env:
 *   E2E_APP_URL        — running app base URL (authed session assumed)
 *   E2E_CONTACT_ID     — a seeded contact's uuid
 *   E2E_CONTACT_NAME   — that contact's display name (asserted in the hub)
 */

import { expect, test } from "@playwright/test";

const APP = process.env.E2E_APP_URL;
const CONTACT_ID = process.env.E2E_CONTACT_ID;
const CONTACT_NAME = process.env.E2E_CONTACT_NAME;

test.describe("Contacts deep links — URL selection (FX-1, AC1)", () => {
  test.skip(
    !APP || !CONTACT_ID || !CONTACT_NAME,
    "E2E_APP_URL / E2E_CONTACT_ID / E2E_CONTACT_NAME not set",
  );

  test("a ?type=contact&id= URL opens that contact, and reload keeps it", async ({ page }) => {
    await page.goto(`${APP}/contacts?type=contact&id=${CONTACT_ID}`);

    // The hub header renders the deep-linked contact.
    await expect(page.getByRole("heading", { name: CONTACT_NAME as string })).toBeVisible();

    // Reload — selection survives (it lives in the URL, not component state).
    await page.reload();
    await expect(page.getByRole("heading", { name: CONTACT_NAME as string })).toBeVisible();
    expect(page.url()).toContain(`id=${CONTACT_ID}`);
  });

  test("selecting a directory row writes the selection into the URL", async ({ page }) => {
    await page.goto(`${APP}/contacts`);
    await page
      .getByRole("button", { name: new RegExp(CONTACT_NAME as string) })
      .first()
      .click();
    await expect(page.getByRole("heading", { name: CONTACT_NAME as string })).toBeVisible();
    expect(page.url()).toContain("type=contact");
    expect(page.url()).toContain(`id=${CONTACT_ID}`);
  });
});
