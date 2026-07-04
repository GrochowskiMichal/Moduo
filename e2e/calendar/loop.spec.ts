// AC8/AC9 — the completion loop (specs/calendar.md). An elapsed block offers
// in-place triage; the strip moves unfinished work into today's real gaps and
// one Undo restores it. Uses Playwright's clock API so "elapsed" is
// deterministic. Not part of `bun run verify`; needs a running app + authed
// session with at least one open task scheduled earlier today.
import { test, expect } from "@playwright/test";

const APP = process.env.E2E_APP_URL;

test.describe("Calendar — the loop: elapsed triage + the strip (AC8, AC9)", () => {
  test.skip(!APP, "E2E_APP_URL not set — run against a live authed session");

  test("an elapsed block offers triage; the strip moves work to today", async ({ page }) => {
    // Pin the clock to mid-afternoon so a morning-scheduled task reads elapsed.
    await page.clock.install({ time: new Date() });
    await page.clock.setFixedTime(new Date(new Date().setHours(15, 0, 0, 0)));

    await page.goto(`${APP}/calendar`);
    await page.waitForSelector("[data-day-col]");

    // The strip renders only when there's unfinished work from earlier. If the
    // seed account has none scheduled in the past, there's nothing to prove.
    const strip = page.getByText(/unfinished from earlier/);
    test.skip(!(await strip.count()), "no unfinished-from-earlier tasks seeded");

    // An elapsed block carries the desaturated treatment (data-elapsed).
    await expect(page.locator("[data-task-block][data-elapsed]").first()).toBeVisible();

    // Move to today places the queue into real gaps; the strip shrinks or clears.
    const before = (await strip.textContent()) ?? "";
    await page.getByRole("button", { name: "Move to today" }).click();
    await expect(async () => {
      const now = page.getByText(/unfinished from earlier/);
      const after = (await now.count()) ? await now.textContent() : "";
      expect(after).not.toBe(before);
    }).toPass();

    // Undo reverses every placement (the strip returns).
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText(/unfinished from earlier/)).toBeVisible();
  });

  test("Review opens the right-panel curation list", async ({ page }) => {
    await page.clock.install({ time: new Date() });
    await page.clock.setFixedTime(new Date(new Date().setHours(15, 0, 0, 0)));
    await page.goto(`${APP}/calendar`);
    await page.waitForSelector("[data-day-col]");

    const review = page.getByRole("button", { name: "Review" });
    test.skip(!(await review.count()), "no strip — nothing to review");
    await review.click();
    await expect(page.getByText(/Unfinished from earlier \(/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Move \d+ to today/ })).toBeVisible();
  });
});
