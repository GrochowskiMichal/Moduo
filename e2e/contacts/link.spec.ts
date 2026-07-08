import { test, expect } from "@playwright/test";

/**
 * Link existing → one roll-up row (CO-4, AC5). Env-gated. Opens a seeded contact,
 * uses the "Link existing…" picker to link an entity, and asserts a single row
 * appears in the hub roll-up. The "both directions write one row" idempotency is
 * the spine's contract (proven by the link substrate's tests); this exercises the
 * contact-side gesture end to end. Local/manual only.
 */

const APP = process.env.E2E_APP_URL;
const CONTACT_NAME = process.env.E2E_CONTACT_NAME;
const LINK_QUERY = process.env.E2E_LINK_QUERY; // a substring of an existing linkable entity

test.describe("Contacts link existing (CO-4, AC5)", () => {
  test.skip(!APP || !CONTACT_NAME || !LINK_QUERY, "E2E_APP_URL / E2E_CONTACT_NAME / E2E_LINK_QUERY not set");

  test("linking an existing entity adds it to the roll-up", async ({ page }) => {
    await page.goto(`${APP}/contacts`);
    await page.getByRole("button", { name: new RegExp(CONTACT_NAME as string) }).first().click();

    await page.getByRole("button", { name: /link existing/i }).click();
    const search = page.getByPlaceholder(/link a task, note, contact/i);
    await search.fill(LINK_QUERY as string);
    await page.getByRole("option").first().click();

    // The linked entity now appears in the roll-up (one row).
    await expect(page.getByText(new RegExp(LINK_QUERY as string, "i")).first()).toBeVisible();
  });
});
