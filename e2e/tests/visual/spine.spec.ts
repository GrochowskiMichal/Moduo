import { expect, test } from "@playwright/test";

/**
 * Spine EntityHub — visual regression (AC6, AC14). Each entry points at a
 * Storybook story id and snapshots the isolated iframe. Local/manual + CI(visual
 * project) only — NOT part of `bun run verify`. Baselines are a deliberate human
 * capture (see docs/gotchas.md), so a first run without PNGs is expected to fail
 * until someone runs:
 *   bun run storybook
 *   bunx playwright test --project=visual --update-snapshots
 */

const STORIES = [
  { name: "entity-hub-populated", id: "spine-entityhub--populated" },
  { name: "entity-hub-empty", id: "spine-entityhub--empty" },
  { name: "entity-hub-loading", id: "spine-entityhub--loading" },
  { name: "entity-hub-tombstone", id: "spine-entityhub--tombstone" },
  { name: "entity-hub-show-all", id: "spine-entityhub--show-all" },
  { name: "entity-hub-page-variant", id: "spine-entityhub--page-variant" },
  // CT-7 — the "Recently linked" dashboard widget (AC12).
  { name: "recently-linked-populated", id: "spine-recentlylinkedwidget--populated" },
  { name: "recently-linked-tombstone", id: "spine-recentlylinkedwidget--with-tombstone" },
  { name: "recently-linked-empty", id: "spine-recentlylinkedwidget--empty" },
];

test.describe("spine entity-hub — visual snapshots", () => {
  for (const story of STORIES) {
    test(story.name, async ({ page }) => {
      await page.goto(`/iframe.html?id=${story.id}&viewMode=story`);
      const root = page.locator("#storybook-root, #root").first();
      await root.waitFor({ state: "visible", timeout: 15_000 });
      await page.waitForTimeout(150);
      await expect(page).toHaveScreenshot(`${story.name}.png`, {
        animations: "disabled",
      });
    });
  }
});
