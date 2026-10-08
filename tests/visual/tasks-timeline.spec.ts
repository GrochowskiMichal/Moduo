import { expect, test } from "@playwright/test";

/**
 * Tasks Timeline view — visual regression (TL-1, AC1–AC4/AC7-render/AC9/AC10).
 * Snapshots the isolated Storybook iframe per state: the bar grammar (solid vs
 * faded edges), muted done bars, the ambient drift dot, the blocked lock, the
 * dependency arrow, lanes + tray, and the empty/read-only states. Local/manual
 * + CI(visual project) only — NOT part of `bun run verify`. Baselines are a
 * deliberate human capture (docs/gotchas.md):
 *   bun run storybook
 *   bunx playwright test --project=visual --update-snapshots
 * NOTE: the today line/pill moves with wall-clock time inside today's column —
 * expect a small, legitimate x-drift between captures taken at different hours.
 */

const STORIES = [
  { name: "timeline-populated", id: "tasks-tasktimelineview--populated" },
  { name: "timeline-week-zoom", id: "tasks-tasktimelineview--week-zoom" },
  { name: "timeline-quarter-zoom", id: "tasks-tasktimelineview--quarter-zoom" },
  { name: "timeline-empty", id: "tasks-tasktimelineview--empty" },
  { name: "timeline-read-only", id: "tasks-tasktimelineview--read-only" },
];

test.describe("tasks timeline — visual snapshots", () => {
  for (const story of STORIES) {
    test(story.name, async ({ page }) => {
      await page.goto(`/iframe.html?id=${story.id}&viewMode=story`);
      const root = page.locator("#storybook-root, #root").first();
      await root.waitFor({ state: "visible", timeout: 15_000 });
      await page.waitForTimeout(200);
      await expect(page).toHaveScreenshot(`${story.name}.png`, { animations: "disabled" });
    });
  }
});
