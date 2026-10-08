import { expect, test } from "@playwright/test";

/**
 * Tasks detail panel — visual regression (tasks-v2 TV-U3, U3-1/U3-3): the comp
 * layout (header with the queue toggle, checkbox + title, aligned values behind
 * a 14px icon slot), property rule C (core always, the rest as one quiet line),
 * the Time row's hairline bar, the comments & activity feed, and the view-only
 * state. Local/manual + CI(visual project) only — NOT part of `bun run verify`.
 * Baselines are a deliberate human capture (docs/gotchas/ui.md):
 *   bun run storybook
 *   bunx playwright test --project=visual tests/visual/tasks-detail.spec.ts --update-snapshots
 * The stories use a fixed "now" and the page clock is frozen at it, so the
 * feed's times and the metadata line read the same at every capture.
 */

const NOW = new Date("2026-10-09T15:00:00");

const STORIES = [
  { name: "tasks-detail-populated", id: "tasks-taskdetailpanel--populated" },
  { name: "tasks-detail-core-only", id: "tasks-taskdetailpanel--core-properties-only" },
  { name: "tasks-detail-read-only", id: "tasks-taskdetailpanel--read-only" },
  { name: "tasks-detail-nothing-selected", id: "tasks-taskdetailpanel--nothing-selected" },
];

test.describe("tasks detail panel — visual snapshots", () => {
  for (const story of STORIES) {
    test(story.name, async ({ page }) => {
      await page.clock.setFixedTime(NOW);
      await page.goto(`/iframe.html?id=${story.id}&viewMode=story`);
      const root = page.locator("#storybook-root, #root").first();
      await root.waitFor({ state: "visible", timeout: 15_000 });
      await page.waitForTimeout(300);
      await expect(page).toHaveScreenshot(`${story.name}.png`, { animations: "disabled" });
    });
  }
});
