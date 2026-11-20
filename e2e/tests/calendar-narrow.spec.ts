import { expect, type Locator, type Page, test } from "@playwright/test";

import { DEV, devWorkspace, type Session, signIn, signInPage } from "./support/local-stack";

/**
 * AC14 (CALR-13) — narrow windows: Calendar keeps its side panels as you left
 * them, as every module does (it no longer folds them), and at 1024 × 700 and
 * 1280 × 800 no toolbar or day-header text overlaps or clips. ⌥3 still opens
 * Plan when the right panel is closed.
 *   scripts/agent/e2e.sh tests/calendar-narrow.spec.ts
 */

test.use({ locale: "en-US" });
test.describe.configure({ mode: "serial", timeout: 90_000 });

let dev: Session;
let ws: { id: string; inboxId: string };

test.beforeAll(async () => {
  dev = await signIn(DEV);
  ws = await devWorkspace(dev);
});

const side = (page: Page, which: "left" | "right") =>
  page.locator(`aside[data-side="${which}"][data-rail-mode="full"]`);

async function openCalendar(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await signInPage(page, dev, ws.id);
  // Start from both panels open, as a wide window leaves them.
  await page.addInitScript(() => {
    const key = "moduo:layout:panels-v2";
    const map = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    map.calendar = { left: true, right: true };
    window.localStorage.setItem(key, JSON.stringify(map));
  });
  await page.goto("/calendar");
  await expect(page.getByRole("toolbar", { name: "Calendar controls" })).toBeVisible({
    timeout: 20_000,
  });
}

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width - 0.5 &&
  b.x < a.x + a.width - 0.5 &&
  a.y < b.y + b.height - 0.5 &&
  b.y < a.y + a.height - 0.5;

/** Every visible leaf with text inside `root`: none overlaps another, none is cut. */
async function expectNoOverlapOrClip(root: Locator) {
  const issues = await root.evaluate((el) => {
    const leaves = Array.from(el.querySelectorAll<HTMLElement>("*")).filter((n) => {
      if (n.children.length > 0 || !n.textContent?.trim()) return false;
      const r = n.getBoundingClientRect();
      const style = getComputedStyle(n);
      return r.width > 0 && r.height > 0 && style.visibility !== "hidden";
    });
    const out: string[] = [];
    const boxes = leaves.map((n) => ({ n, r: n.getBoundingClientRect() }));
    for (const { n } of boxes) {
      // A truncating label is allowed to ellipsize; a hard clip is not.
      const truncates = getComputedStyle(n).textOverflow === "ellipsis";
      if (!truncates && n.scrollWidth > n.clientWidth + 1 && n.clientWidth > 0)
        out.push(`clipped: ${n.textContent}`);
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (a.n.contains(b.n) || b.n.contains(a.n)) continue;
        if (
          a.r.left < b.r.right - 0.5 &&
          b.r.left < a.r.right - 0.5 &&
          a.r.top < b.r.bottom - 0.5 &&
          b.r.top < a.r.bottom - 0.5
        )
          out.push(`overlap: "${a.n.textContent}" × "${b.n.textContent}"`);
      }
    return out;
  });
  expect(issues).toEqual([]);
}

for (const [width, height] of [
  [1024, 700],
  [1280, 800],
] as const) {
  test(`${width} × ${height}: both panels stay, nothing overlaps`, async ({ page }) => {
    await openCalendar(page, width, height);
    await expect(side(page, "left")).toBeVisible();
    await expect(side(page, "right")).toBeVisible();

    const toolbar = page.getByRole("toolbar", { name: "Calendar controls" });
    await expectNoOverlapOrClip(toolbar);
    const headers = page.locator("[data-day-header]");
    expect(await headers.count()).toBeGreaterThan(0);
    for (const header of await headers.all()) await expectNoOverlapOrClip(header);
    const toolbarBox = (await toolbar.boundingBox())!;
    const main = (await page.locator("main").first().boundingBox())!;
    expect(toolbarBox.x + toolbarBox.width).toBeLessThanOrEqual(main.x + main.width + 0.5);
    expect(overlaps(toolbarBox, (await side(page, "right").boundingBox())!)).toBe(false);
    expect(overlaps(toolbarBox, (await side(page, "left").boundingBox())!)).toBe(false);
  });
}

test("⌥3 opens Plan when the right panel is closed", async ({ page }) => {
  await openCalendar(page, 1024, 700);
  await page.getByRole("button", { name: "Collapse right panel" }).click();
  await expect(side(page, "right")).toHaveCount(0);
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("Alt+3");
  await expect(side(page, "right")).toBeVisible();
  await expect(side(page, "right")).toContainText(/Tasks|Plan/);
  await expect(side(page, "left")).toBeVisible();
});
