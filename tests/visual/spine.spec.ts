import { test, expect } from "@playwright/test";

/**
 * Spine EntityHub + EntityRefChip — visual regression (AC6, AC8, AC14). Each
 * entry points at a Storybook story id and snapshots the isolated iframe.
 * Local/manual + CI(visual project) only — NOT part of `bun run verify`.
 * Baselines are a deliberate human capture (see docs/gotchas.md), so a first run
 * without PNGs is expected to fail until someone runs:
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
  // EntityRefChip — neutral monochrome, type-glyph (no hue) per AC8 + R5.
  { name: "entity-ref-chip-task", id: "spine-entityrefchip--task" },
  { name: "entity-ref-chip-contact", id: "spine-entityrefchip--contact" },
  { name: "entity-ref-chip-note", id: "spine-entityrefchip--note" },
  { name: "entity-ref-chip-tombstoned", id: "spine-entityrefchip--tombstoned" },
  { name: "entity-ref-chip-in-prose", id: "spine-entityrefchip--in-prose" },
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
