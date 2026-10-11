import { expect, type Page, test } from "@playwright/test";

/**
 * The Tasks sidebar — "decided sidebar" (TV-U6; specs/tasks-v3.md AC11.1,
 * AC11.10; prototype round-1c frame 1): the order and the hairline, no labels
 * on the blocks and no glyphs on views, collapsible groups in one
 * sentence-case header style, Pinned only when used, and Archived projects and
 * Recently deleted in the hairline's ⋯, never as rows.
 *
 * The structure checks run on their own; the screenshots need baselines, which
 * a human captures, never an agent (DESIGN_SYSTEM §5):
 *   bun run storybook
 *   bunx playwright test --project=visual tests/visual/sidebar.spec.ts --update-snapshots
 */

const DENSITIES = ["comfortable", "compact", "dense"] as const;
const SHADES = ["black", "warm", "cool", "slate", "plum", "forest"] as const;

async function open(page: Page, story: string, globals = "theme:dark") {
  await page.goto(`/iframe.html?id=tasks-sidebar--${story}&viewMode=story&globals=${globals}`);
  const nav = page.getByRole("navigation", { name: "Tasks" });
  await nav.waitFor({ state: "visible", timeout: 15_000 });
  return nav;
}

/** The sidebar's rows and headers, top to bottom; "—" is the hairline. */
async function order(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-slot="nav-row-label"], [data-slot="nav-section-header"] [data-slot="nav-row-main"] > span:first-child, [data-slot="sidebar-hairline"]',
      ),
    ).map((el) => (el.dataset.slot === "sidebar-hairline" ? "—" : (el.textContent ?? ""))),
  );
}

test.describe("decided sidebar — structure (AC11.1, AC11.10)", () => {
  test("a fresh workspace: no headers, the hairline, All, its projects", async ({ page }) => {
    const nav = await open(page, "fresh-workspace");
    expect(await order(page)).toEqual([
      "Inbox",
      "Focus",
      "Upcoming",
      "—",
      "All",
      "Launch v1",
      "Website",
      "Acme rebrand",
    ]);
    await expect(nav.locator('[data-slot="nav-section-header"]')).toHaveCount(0);
  });

  test("a busy workspace: Pinned once used, areas with their projects, one collapsed", async ({
    page,
  }) => {
    await open(page, "busy-workspace");
    expect(await order(page)).toEqual([
      "Inbox",
      "Focus",
      "Upcoming",
      "My tasks",
      "—",
      "All",
      "Pinned",
      "Launch v1",
      "Product",
      "Launch v1",
      "Website",
      "Bugs",
      "Clients",
      "Acme rebrand",
      "Northwind app",
      "School",
      "Personal",
      "Home",
    ]);
  });

  test("no labels on the blocks, no glyphs on views, sentence-case headers", async ({ page }) => {
    const nav = await open(page, "busy-workspace");
    for (const word of ["You", "Workspace", "Projects", "Views", "Buckets"]) {
      await expect(nav.getByText(word, { exact: true })).toHaveCount(0);
    }
    const transforms = await nav
      .locator('[data-slot="nav-section-header"]')
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).textTransform));
    expect(transforms.every((t) => t === "none")).toBe(true);
    // A project row leads with its colour dot, never an icon.
    const row = nav.getByRole("button", { name: /^Website\s*,/ }).first();
    await expect(row.locator("svg")).toHaveCount(0);
  });

  test("every group collapses", async ({ page }) => {
    const nav = await open(page, "busy-workspace");
    await nav.getByRole("button", { name: /^Clients\s*,/ }).click();
    await expect(nav.getByRole("button", { name: /^Acme rebrand\s*,/ })).toHaveCount(0);
    await nav.getByRole("button", { name: /^Pinned/ }).click();
    await expect(nav.getByRole("button", { name: /^Launch v1\s*,/ })).toHaveCount(1);
  });

  test("Customize, Archived projects and Recently deleted live in the hairline's ⋯", async ({
    page,
  }) => {
    const nav = await open(page, "busy-workspace");
    await expect(nav.getByRole("button", { name: /Archived|Recently deleted/ })).toHaveCount(0);
    await nav.locator('[data-slot="sidebar-hairline"]').hover();
    await page.getByRole("button", { name: "Sidebar options" }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByText("Customize sidebar")).toBeVisible();
    await expect(menu.getByRole("menuitemcheckbox")).toHaveText([
      "Focus",
      "Upcoming",
      "My tasks",
      "All",
    ]);
    await expect(menu.getByRole("menuitem", { name: /^Archived projects/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /^Recently deleted/ })).toBeVisible();
  });

  test("Customize sidebar hides rows; the Inbox always shows", async ({ page }) => {
    await open(page, "customized");
    const rows = await order(page);
    expect(rows).not.toContain("Upcoming");
    expect(rows).not.toContain("All");
    expect(rows[0]).toBe("Inbox");
  });
});

test.describe("decided sidebar — visual snapshots", () => {
  for (const story of ["fresh-workspace", "busy-workspace", "customized", "read-only"]) {
    test(`sidebar-${story}`, async ({ page }) => {
      await open(page, story);
      await page.waitForTimeout(150);
      await expect(page).toHaveScreenshot(`sidebar-${story}.png`, { animations: "disabled" });
    });
  }
  for (const density of DENSITIES) {
    test(`sidebar-${density}`, async ({ page }) => {
      await open(page, "busy-workspace", `theme:dark;density:${density}`);
      await page.waitForTimeout(150);
      await expect(page).toHaveScreenshot(`sidebar-${density}.png`, { animations: "disabled" });
    });
  }
  for (const shade of SHADES) {
    test(`sidebar-shade-${shade}`, async ({ page }) => {
      await open(page, "busy-workspace", `theme:dark;shade:${shade}`);
      await page.waitForTimeout(150);
      await expect(page).toHaveScreenshot(`sidebar-shade-${shade}.png`, {
        animations: "disabled",
      });
    });
  }
});
