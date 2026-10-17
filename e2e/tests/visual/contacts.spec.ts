import { expect, test } from "@playwright/test";

/**
 * Contacts ContactHub — visual regression (CO-2, AC2/AC12). Snapshots the
 * isolated Storybook iframe per state; confirms no "log activity" control, tokens
 * only, status as color + label. Local/manual + CI(visual project) only — NOT
 * part of `bun run verify`. Baselines are a deliberate human capture
 * (docs/gotchas.md):
 *   bun run storybook
 *   bunx playwright test --project=visual --update-snapshots
 */

const STORIES = [
  { name: "contact-hub-populated", id: "contacts-contacthub--populated" },
  { name: "contact-hub-empty-rollup", id: "contacts-contacthub--empty-rollup" },
  { name: "contact-hub-loading", id: "contacts-contacthub--loading" },
  { name: "contact-hub-permission-denied", id: "contacts-contacthub--permission-denied" },
  { name: "contact-hub-tombstone", id: "contacts-contacthub--tombstone" },
];

// CO-3 / AC6: the CSV import dialog at its two decision steps. The dialog is
// portalled, so target the portal root, not #storybook-root.
const IMPORT_STORIES = [
  { name: "import-dialog-map", id: "contacts-contactimportdialog--mapping" },
  { name: "import-dialog-dedupe-preview", id: "contacts-contactimportdialog--dedupe-preview" },
];

test.describe("contacts contact-hub — visual snapshots", () => {
  for (const story of STORIES) {
    test(story.name, async ({ page }) => {
      await page.goto(`/iframe.html?id=${story.id}&viewMode=story`);
      const root = page.locator("#storybook-root, #root").first();
      await root.waitFor({ state: "visible", timeout: 15_000 });
      await page.waitForTimeout(150);
      await expect(page).toHaveScreenshot(`${story.name}.png`, { animations: "disabled" });
    });
  }
});

// CO-5 / AC11: the "Needs attention" dashboard widget (quiet, deep-linking).
const NEEDS_ATTENTION_STORIES = [
  { name: "needs-attention-widget", id: "contacts-needsattentionwidget--populated" },
  { name: "needs-attention-widget-empty", id: "contacts-needsattentionwidget--empty" },
];

test.describe("contacts needs-attention-widget — visual snapshots", () => {
  for (const story of NEEDS_ATTENTION_STORIES) {
    test(story.name, async ({ page }) => {
      await page.goto(`/iframe.html?id=${story.id}&viewMode=story`);
      const root = page.locator("#storybook-root, #root").first();
      await root.waitFor({ state: "visible", timeout: 15_000 });
      await page.waitForTimeout(150);
      await expect(page).toHaveScreenshot(`${story.name}.png`, { animations: "disabled" });
    });
  }
});

// CO-4 / AC8: the company hub (People group + unioned work roll-up).
const COMPANY_STORIES = [
  { name: "company-hub-populated", id: "contacts-companyhub--populated" },
  { name: "company-hub-empty", id: "contacts-companyhub--empty" },
];

test.describe("contacts company-hub — visual snapshots", () => {
  for (const story of COMPANY_STORIES) {
    test(story.name, async ({ page }) => {
      await page.goto(`/iframe.html?id=${story.id}&viewMode=story`);
      const root = page.locator("#storybook-root, #root").first();
      await root.waitFor({ state: "visible", timeout: 15_000 });
      await page.waitForTimeout(150);
      await expect(page).toHaveScreenshot(`${story.name}.png`, { animations: "disabled" });
    });
  }
});

test.describe("contacts import-dialog — visual snapshots", () => {
  for (const story of IMPORT_STORIES) {
    test(story.name, async ({ page }) => {
      await page.goto(`/iframe.html?id=${story.id}&viewMode=story`);
      const dialog = page.getByRole("dialog");
      await dialog.waitFor({ state: "visible", timeout: 15_000 });
      await page.waitForTimeout(150);
      await expect(dialog).toHaveScreenshot(`${story.name}.png`, { animations: "disabled" });
    });
  }
});
