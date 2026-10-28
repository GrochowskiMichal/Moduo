import { expect, type Page, test } from "@playwright/test";

import {
  DEV,
  devWorkspace,
  rest,
  rpc,
  runTag,
  type Session,
  signIn,
  signInPage,
} from "./support/local-stack";

/**
 * CALR-4b (AC22's ⌃↵, AC26) — the event menus, against the local stack:
 * right-click an event for a short menu without shortcuts; Duplicate from it
 * adds the copy right after; ⌃↵ opens the same menu at the selection and
 * Delete from it deletes with Undo; the Event panel's ⋯ shows the same items
 * with their keys; Escape gives focus back to the grid.
 *   scripts/agent/e2e.sh tests/calendar-menus.spec.ts
 */

test.use({ locale: "en-US" });
test.describe.configure({ mode: "serial", timeout: 90_000 });

let dev: Session;
let ws: { id: string; inboxId: string };
let tag: string;

type Row = { id: string; title: string; start_time: string; deleted_at: string | null };

test.beforeAll(async () => {
  dev = await signIn(DEV);
  ws = await devWorkspace(dev);
  tag = runTag();
});

test.afterAll(async () => {
  await rest("service", `calendar_events?workspace_id=eq.${ws.id}&title=like.*${tag}*`, {
    method: "PATCH",
    body: { deleted_at: new Date().toISOString() },
  });
});

function today(hour: number, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

const live = async () =>
  (
    await rest<Row[]>(
      "service",
      `calendar_events?workspace_id=eq.${ws.id}&title=like.*${tag}*&select=id,title,start_time,deleted_at`,
    )
  )
    .filter((r) => !r.deleted_at)
    .map((r) => ({ ...r, start_time: new Date(r.start_time).toISOString() }));

async function openWeek(page: Page, title: string) {
  await signInPage(page, dev, ws.id);
  await page.goto("/calendar");
  const grid = page.locator("[data-calendar-grid]");
  await expect(grid).toBeVisible({ timeout: 20_000 });
  const chip = page.locator("[data-occurrence-key]", { hasText: title }).first();
  await expect(chip).toBeVisible({ timeout: 20_000 });
  return { grid, chip };
}

const ITEMS = [
  "Open",
  "Copy",
  "Duplicate",
  "Make private",
  "Link a person, note or task",
  "Delete",
];

test("the event menus", async ({ page }) => {
  const title = `Menu ${tag}`;
  await rpc(dev, "calendar_op_event_create", {
    p_workspace_id: ws.id,
    p_title: title,
    p_starts_at: today(10),
    p_ends_at: today(11),
    p_all_day: false,
    p_rrule: null,
    p_description: "",
  });
  const { grid, chip } = await openWeek(page, title);

  // Right-click: the short menu, no shortcuts.
  await chip.click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  for (const name of ITEMS) {
    await expect(menu.getByRole("menuitem", { name, exact: true })).toBeVisible();
  }
  await expect(menu.locator('[data-slot="dropdown-menu-shortcut"]')).toHaveCount(0);

  // Escape closes it; focus is back on the grid.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(grid).toBeFocused();

  // Duplicate from the menu: the copy lands right after the original.
  await chip.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
  await expect.poll(async () => (await live()).length).toBe(2);
  expect((await live()).map((r) => r.start_time).sort()).toEqual([today(10), today(11)]);

  // ⌃↵ on the selected event opens the same menu; Delete deletes with Undo.
  await chip.click({ button: "right" });
  await page.keyboard.press("Escape");
  await grid.focus();
  await page.keyboard.press("Control+Enter");
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-slot="dropdown-menu-shortcut"]')).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect.poll(async () => (await live()).length).toBe(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await live()).length).toBe(2);

  // Open from the menu shows the Event panel; its ⋯ lists the same items with keys.
  await chip.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open", exact: true }).click();
  const more = page.getByRole("button", { name: "Event actions" });
  await expect(more).toBeVisible();
  await more.click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /^Copy/ })).toContainText(/⌘C|Ctrl C/);
  await expect(menu.getByRole("menuitem", { name: /^Duplicate/ })).toContainText(/⌘D|Ctrl D/);
  await expect(menu.getByRole("menuitem", { name: /^Make private/ })).toContainText("P");
  await expect(menu.getByRole("menuitem", { name: /^Link a person/ })).toContainText("L");
  await expect(menu.getByRole("menuitem", { name: /^Delete/ })).toContainText("⌫");
  await expect(menu.getByRole("menuitem", { name: "Open", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
});
