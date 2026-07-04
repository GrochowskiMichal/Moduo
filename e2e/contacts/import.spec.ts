import { test, expect } from "@playwright/test";

/**
 * Contacts CSV import (CO-3, AC6). Env-gated like the other contacts e2e specs:
 * runs against a seeded, authenticated app (E2E_APP_URL) where the current
 * workspace has edit access to contacts. Drives the real 3-step dialog —
 * choose file → map columns → preview dedupe → import — and asserts the
 * directory lands populated with the imported person. Local/manual only; NOT
 * part of `bun run verify` (docs/gotchas.md). Server round-trip needs the
 * migration deployed.
 */

const APP = process.env.E2E_APP_URL;

// A unique name per run so re-runs don't collide with a prior import.
const STAMP = process.env.E2E_IMPORT_STAMP ?? "imp";
const PERSON = `Csv Person ${STAMP}`;
const CSV = `Name,Email,Company\n${PERSON},csv-${STAMP}@example.com,Imported Co\n`;

test.describe("Contacts CSV import — populates the directory (CO-3, AC6)", () => {
  test.skip(!APP, "E2E_APP_URL not set");

  test("drop → map → preview → import lands the directory populated", async ({ page }) => {
    await page.goto(`${APP}/contacts`);

    // Open the import dialog.
    await page.getByRole("button", { name: /import contacts/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Step 1 — provide the CSV via the (hidden) file input.
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "contacts.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(CSV, "utf-8"),
    });

    // Step 2 — the column map; defaults are auto-guessed. Continue.
    await dialog.getByRole("button", { name: /continue/i }).click();

    // Step 3 — preview shows the new row; import it.
    await expect(dialog.getByText(/1 new/i)).toBeVisible();
    await dialog.getByRole("button", { name: /import 1 contact/i }).click();

    // The dialog closes and the directory now lists the imported person.
    await expect(dialog).toBeHidden();
    await expect(page.getByText(PERSON).first()).toBeVisible();
  });
});
