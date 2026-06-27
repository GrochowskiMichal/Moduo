import { test, expect } from "@playwright/test";

/**
 * Add follow-up (CO-4, AC4). Env-gated like the other contacts e2e specs. Opens a
 * seeded contact, adds a follow-up, and asserts it lands as an ordinary task in
 * the hub's Open work roll-up (the open-items count ticks). Local/manual only;
 * needs the migrations deployed + an authenticated, edit-access workspace.
 */

const APP = process.env.E2E_APP_URL;
const CONTACT_NAME = process.env.E2E_CONTACT_NAME;

test.describe("Contacts add follow-up (CO-4, AC4)", () => {
  test.skip(!APP || !CONTACT_NAME, "E2E_APP_URL / E2E_CONTACT_NAME not set");

  test("adding a follow-up appears as a linked task under Open work", async ({ page }) => {
    await page.goto(`${APP}/contacts`);
    await page.getByRole("button", { name: new RegExp(CONTACT_NAME as string) }).first().click();

    await page.getByRole("button", { name: /add follow-up/i }).click();

    // The success toast confirms the task + link were written…
    await expect(page.getByText(/follow-up added/i)).toBeVisible();
    // …and the roll-up now shows an Open work group with the follow-up task.
    await expect(page.getByText(/Open work/i).first()).toBeVisible();
    await expect(page.getByText(new RegExp(`Follow up with ${CONTACT_NAME}`, "i")).first()).toBeVisible();
  });
});
