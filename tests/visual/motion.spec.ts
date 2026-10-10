import { expect, type Page, test } from "@playwright/test";

/**
 * Motion foundations — tokens and reduced motion (tasks-v3 AC14.2, SH-1). The
 * four patterns run on the three durations, and with reduced motion (the OS
 * setting, or Settings → Preferences → Motion) only opacity changes. Reads
 * computed styles, so there are no baselines to capture. Local/manual + CI
 * (visual project) only, NOT part of `bun run verify` (src/styles/motion.test.ts
 * guards the same rules there):
 *   bun run storybook
 *   bunx playwright test --project=visual tests/visual/motion.spec.ts
 * Reduced motion is emulated before the page loads: a computed style read right
 * after flipping it can report the old value (docs/gotchas/ui.md).
 */

async function openStory(page: Page, id: string) {
  await page.goto(`/iframe.html?id=${id}&viewMode=story`);
  await page.locator("#storybook-root, #root").first().waitFor({ state: "visible" });
}

/** `animation-name` / `animation-duration`, paired up, for one element. */
async function animationsOf(page: Page, testId: string) {
  return page
    .getByTestId(testId)
    .first()
    .evaluate((el) => {
      const style = getComputedStyle(el);
      const names = style.animationName.split(",").map((s) => s.trim());
      const durations = style.animationDuration.split(",").map((s) => s.trim());
      return Object.fromEntries(names.map((name, i) => [name, durations[i] ?? durations[0]]));
    });
}

const token = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

/** A duration token in ms, however the build wrote it ("100ms", ".1s", "0s"). */
async function tokenMs(page: Page, name: string): Promise<number> {
  const raw = await token(page, name);
  const n = Number.parseFloat(raw);
  return raw.endsWith("ms") ? n : Math.round(n * 1000);
}

test.describe("motion foundations", () => {
  test("the patterns run on the three durations", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openStory(page, "foundations-motion--default");
    expect(await tokenMs(page, "--motion-fast")).toBe(100);
    expect(await tokenMs(page, "--motion-base")).toBe(180);
    expect(await tokenMs(page, "--motion-slow")).toBe(280);

    expect(await animationsOf(page, "motion-panel")).toEqual({
      "motion-fade-in": "0.1s",
      "motion-slide-in": "0.28s",
    });
    expect(await animationsOf(page, "motion-row")).toEqual({
      "motion-row-open": "0.18s",
      "motion-fade-in": "0.1s",
    });
    expect(await animationsOf(page, "motion-view")).toEqual({ "motion-fade-in": "0.28s" });

    await page.getByRole("button", { name: "Open a menu" }).click();
    const menu = page.getByTestId("motion-pop");
    await expect(menu).toBeVisible();
    expect(await animationsOf(page, "motion-pop")).toEqual({
      "motion-fade-in": "0.1s",
      "motion-grow-in": "0.18s",
    });
    // Grows from the trigger's corner, not from its own centre.
    const origin = await menu.evaluate((el) => getComputedStyle(el).transformOrigin);
    expect(origin).not.toBe(
      await menu.evaluate((el) => `${el.clientWidth / 2}px ${el.clientHeight / 2}px`),
    );
  });

  test("reduced motion leaves only opacity", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openStory(page, "foundations-motion--default");
    expect(await tokenMs(page, "--motion-slow")).toBe(0);
    expect(await token(page, "--motion-shift")).toBe("0");
    expect(await token(page, "--motion-grow")).toBe("1");

    // Movement takes no time and travels nowhere; the fades stay, short.
    expect(await animationsOf(page, "motion-panel")).toEqual({
      "motion-fade-in": "0.08s",
      "motion-slide-in": "0s",
    });
    expect(await animationsOf(page, "motion-row")).toEqual({
      "motion-row-open": "0s",
      "motion-fade-in": "0.08s",
    });
    expect(await animationsOf(page, "motion-view")).toEqual({ "motion-fade-in": "0.08s" });
  });

  test("Settings → Motion → Reduced does the same on a machine that allows motion", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openStory(page, "foundations-motion--reduced");
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
    expect(await animationsOf(page, "motion-panel")).toEqual({
      "motion-fade-in": "0.08s",
      "motion-slide-in": "0s",
    });
    expect(await animationsOf(page, "motion-view")).toEqual({ "motion-fade-in": "0.08s" });
  });
});
