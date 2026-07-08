/**
 * widget.spec.ts — block CT-7, AC12 ("Recently linked" widget deep-links).
 *
 * Drives the widget's Storybook story and asserts clicking a link endpoint
 * dispatches the `moduo:entity:open` event the app chrome listens for (the same
 * deep-link gesture as the EntityRefChip + notifications). Manual/local: needs
 * Storybook running; NOT part of `bun run verify` (visual/e2e stay local —
 * gotchas.md). Skips unless E2E_STORYBOOK_URL is set.
 */

import { test, expect } from "@playwright/test";

const STORYBOOK = process.env.E2E_STORYBOOK_URL; // e.g. http://127.0.0.1:6006

async function openStory(page: import("@playwright/test").Page, id: string) {
  await page.goto(`${STORYBOOK}/iframe.html?id=${id}&viewMode=story`);
  const root = page.locator("#storybook-root, #root").first();
  await root.waitFor({ state: "visible", timeout: 15_000 });
}

test.describe("Recently-linked widget deep-links (CT-7, AC12)", () => {
  test.skip(!STORYBOOK, "E2E_STORYBOOK_URL not set (run `bun run storybook` first)");

  test("clicking a link endpoint dispatches moduo:entity:open with its ref", async ({ page }) => {
    await openStory(page, "spine-recentlylinkedwidget--populated");

    // Capture the deep-link event the app chrome routes to the entity's hub.
    await page.evaluate(() => {
      (window as unknown as { __opened: unknown[] }).__opened = [];
      window.addEventListener("moduo:entity:open", (e) =>
        (window as unknown as { __opened: unknown[] }).__opened.push((e as CustomEvent).detail),
      );
    });

    await page.getByRole("button", { name: "Ship the launch page" }).first().click();

    const opened = await page.evaluate(() => (window as unknown as { __opened: unknown[] }).__opened);
    expect(opened).toContainEqual({ type: "task", id: "t1" });
  });

  test("a tombstoned endpoint is shown as deleted and is not clickable", async ({ page }) => {
    await openStory(page, "spine-recentlylinkedwidget--with-tombstone");
    await expect(page.getByRole("button", { name: /Deleted task/ })).toBeDisabled();
  });
});
