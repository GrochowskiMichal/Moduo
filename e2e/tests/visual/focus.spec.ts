import { expect, test } from "@playwright/test";

/**
 * Focus — visual regression (TV-F7, AC8.2, AC8.9; prototype round-2a frames
 * 1–3): the Now card ready to Start, running Per task (one pill on the card),
 * Pomodoro (one pill in the header), Timer off (no pill), and nothing lined up
 * (the three ways in, today's scheduled tasks as rows). Local/manual +
 * CI(visual project) only — NOT part of `bun run verify`. Baselines are a
 * deliberate human capture (docs/gotchas/ui.md):
 *   bun run storybook
 *   bunx playwright test --project=visual tests/visual/focus.spec.ts --update-snapshots
 * The page clock is frozen, so the running clocks read the same every time.
 */

const NOW = new Date("2026-10-13T08:00:00Z");

test.use({ timezoneId: "Europe/Warsaw" });

const STORIES = [
  { name: "focus-ready", id: "tasks-focusview--ready" },
  { name: "focus-running-per-task", id: "tasks-focusview--running-per-task" },
  { name: "focus-pomodoro", id: "tasks-focusview--pomodoro" },
  { name: "focus-timer-off", id: "tasks-focusview--timer-off" },
  { name: "focus-nothing-lined-up", id: "tasks-focusview--nothing-lined-up" },
];

test.describe("focus — visual snapshots", () => {
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
