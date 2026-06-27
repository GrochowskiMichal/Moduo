import { test, expect } from "@playwright/test";

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
