import { expect, test } from "@playwright/test";

import { PERF_USER } from "../../scripts/perf/seed-tasks-10k";
import { seedTimelineFixture, TIMELINE_PROJECT } from "../../scripts/perf/seed-timeline-2k";
import { signIn, signInPage } from "../support/local-stack";

/**
 * Tasks v3 AC9.9 — "endless scroll with 2,000 points" (TV-TL1), against the
 * LOCAL stack only, like the 10k budget:
 *   bun run local:up && bun run env:local
 *   MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8131
 *   E2E_BASE_URL=http://127.0.0.1:8131 bunx playwright test --project=perf tests/perf/tasks-timeline-2k.spec.ts
 * (it seeds its own workspace, "Timeline 2k", for the perf person:
 * `bun scripts/perf/seed-timeline-2k.ts`).
 *
 * The Roadmap project holds 1,700 of the 2,000 dated tasks, so its Timeline
 * draws only the rows on screen. The canvas scrolls a quarter later and a
 * quarter back, a step every frame, and each frame's time is measured in the
 * page: the slow frames must stay rare and the typical one inside a 60 Hz
 * frame. Then the scroll runs to the canvas's left edge, and the canvas grows
 * there (it scrolls endlessly).
 */

const FRAME_MS = 1000 / 60;

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 900 }, locale: "en-US" });

let workspaceId: string;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  ({ workspaceId } = await seedTimelineFixture());
});

type ScrollResult = { frames: number[]; rows: number; dw: number };

test("endless scroll with 2,000 points", async ({ page }) => {
  test.setTimeout(120_000);
  const perf = await signIn(PERF_USER);
  await signInPage(page, perf, workspaceId);
  await page.goto("/tasks");
  await page.locator("nav").getByText(TIMELINE_PROJECT, { exact: true }).first().click();
  await page.getByRole("radio", { name: "Timeline view" }).click();
  const timeline = page.locator("[data-timeline]");
  await expect(timeline).toBeVisible({ timeout: 30_000 });
  // The rest of the tasks are in, and the rows are drawn.
  await expect(page.locator('[data-timeline-row="task"]').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1000);

  // A quarter later, then a quarter back: one step a frame, each frame timed.
  const result = await page.evaluate(async (): Promise<ScrollResult> => {
    const el = document.querySelector<HTMLElement>("[data-timeline]");
    if (!el) throw new Error("no timeline");
    // Month's day width: the zoom it opens at inside a project.
    const dw = 24;
    const quarter = 91 * dw;
    const steps = 60;
    const frames: number[] = [];
    const run = (direction: 1 | -1) =>
      new Promise<void>((resolve) => {
        let i = 0;
        let last = performance.now();
        const tick = (now: number) => {
          if (i > 0) frames.push(now - last);
          last = now;
          if (i++ >= steps) {
            resolve();
            return;
          }
          el.scrollLeft += (direction * quarter) / steps;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    await run(1);
    await run(-1);
    const rows = document.querySelectorAll('[data-timeline-row="task"]').length;
    return { frames, rows, dw };
  });
  const sorted = [...result.frames].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const slow = result.frames.filter((f) => f > 2 * FRAME_MS).length;
  console.log(
    `timeline scroll: ${result.frames.length} frames, median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, ${slow} over two frames; ${result.rows} task rows drawn`,
  );
  // Only the rows on screen are drawn (1,700 tasks in the project).
  expect(result.rows).toBeLessThan(200);
  // Smooth: the typical frame inside a 60 Hz frame, slow frames rare.
  expect(median).toBeLessThan(FRAME_MS + 4);
  expect(slow).toBeLessThanOrEqual(Math.ceil(result.frames.length * 0.05));

  // Endless: at the left edge the canvas grows, and the scroll stays on the same day.
  const grown = await page.evaluate(async () => {
    const el = document.querySelector<HTMLElement>("[data-timeline]");
    if (!el) throw new Error("no timeline");
    const before = el.scrollWidth;
    el.scrollLeft = 0;
    await new Promise((r) => setTimeout(r, 600));
    return { before, after: el.scrollWidth, left: el.scrollLeft };
  });
  expect(grown.after).toBeGreaterThan(grown.before);
  expect(grown.left).toBeGreaterThan(0);
});
