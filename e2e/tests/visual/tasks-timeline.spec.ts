import { expect, test } from "@playwright/test";

/**
 * Tasks Timeline view — visual regression (TV-TL1: AC9.1–9.5, AC2.7).
 * Snapshots the isolated Storybook iframe per state: All at Quarter (project
 * bars with their phases and progress), Due per week, one project at Month
 * (sections as bands and diamonds, tasks as points: due, late, sessions-only,
 * a repeat), the empty canvas and the read-only one. Each also checks that
 * nothing on the canvas is rotated (46a). Local/manual + CI(visual project)
 * only — NOT part of `bun run verify`. Baselines are a deliberate human
 * capture (docs/gotchas.md):
 *   bun run storybook
 *   bunx playwright test --project=visual --update-snapshots
 * NOTE: the stories date everything from today, and the canvas opens with
 * today a quarter across: captures from different days line up.
 */

const STORIES = [
  { name: "timeline-all-projects", id: "tasks-tasktimelineview--all-projects" },
  { name: "timeline-due-per-week", id: "tasks-tasktimelineview--due-per-week" },
  { name: "timeline-inside-a-project", id: "tasks-tasktimelineview--inside-a-project" },
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
      // Text is never rotated (46a): no element on the canvas is turned.
      const rotated = await page.evaluate(() =>
        [...document.querySelectorAll("[data-timeline] *")].some((el) => {
          const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(el).transform);
          if (!m) return false;
          const [a, b] = (m[1] ?? "").split(",").map(Number);
          return Math.abs(Math.atan2(b ?? 0, a ?? 1)) > 0.01;
        }),
      );
      expect(rotated).toBe(false);
      await expect(page).toHaveScreenshot(`${story.name}.png`, { animations: "disabled" });
    });
  }
});
