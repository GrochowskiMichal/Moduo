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
 * CALR-4 (AC21, AC22) — the week by keys alone, against the local stack: the
 * grid is one Tab stop with a cursor; J picks an event; ⌥↓ moves it 15
 * minutes with an Undo toast and ⌘Z puts it back; ⌘D duplicates it, ⌘C / ⌘V
 * copy it to the cursor; ⌫ deletes at once (no dialog) and ⌘Z restores it;
 * ⌘→ / ⌘← step the week; single keys stay silent in a field.
 *   scripts/agent/e2e.sh tests/calendar-keyboard.spec.ts
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

/** Today at a wall-clock hour, as an ISO instant. */
function today(hour: number, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

async function rows(): Promise<Row[]> {
  return rest<Row[]>(
    "service",
    `calendar_events?workspace_id=eq.${ws.id}&title=like.*${tag}*&select=id,title,start_time,deleted_at`,
  );
}

// PostgREST answers "…+00:00": compare as ISO instants.
const live = async () =>
  (await rows())
    .filter((r) => !r.deleted_at)
    .map((r) => ({ ...r, start_time: new Date(r.start_time).toISOString() }));

async function openWeek(page: Page) {
  await signInPage(page, dev, ws.id);
  await page.goto("/calendar");
  const grid = page.locator("[data-calendar-grid]");
  await expect(grid).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-chip="event"]', { hasText: tag }).first()).toBeVisible({
    timeout: 20_000,
  });
  return grid;
}

test("the week by keys alone", async ({ page }) => {
  const title = `Keys ${tag}`;
  await rpc(dev, "calendar_op_event_create", {
    p_workspace_id: ws.id,
    p_title: title,
    p_starts_at: today(10),
    p_ends_at: today(11),
    p_all_day: false,
    p_rrule: null,
    p_description: "",
  });

  const grid = await openWeek(page);
  await grid.focus();
  await expect(page.locator("[data-grid-cursor]")).toBeVisible();

  // J picks the next event; the selection ring is on it.
  // Start from the top of the day so J reaches the 10:00 event.
  for (let i = 0; i < 48; i++) await page.keyboard.press("ArrowUp");
  let picked = false;
  for (let i = 0; i < 20 && !picked; i++) {
    await page.keyboard.press("j");
    picked =
      (await page
        .locator('[data-chip="event"]', { hasText: title })
        .locator('[data-selected="true"]')
        .count()) > 0;
  }
  expect(picked).toBe(true);

  // ⌥↓ moves it 15 minutes, with an Undo toast; ⌘Z puts it back.
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page.getByText("Event moved")).toBeVisible();
  await expect.poll(async () => (await live())[0]?.start_time).toBe(today(10, 15));
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await live())[0]?.start_time).toBe(today(10));

  // ⌘D duplicates it right after.
  await page.keyboard.press("ControlOrMeta+d");
  await expect.poll(async () => (await live()).length).toBe(2);
  expect((await live()).map((r) => r.start_time).sort()).toEqual([today(10), today(11)]);

  // ⌘C, then ⌘V at the cursor (moved off the event to a free slot).
  await page.keyboard.press("ControlOrMeta+c");
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(async () => (await live()).length).toBe(3);

  // ⌫ deletes the selected event at once: no dialog, an Undo toast, ⌘Z restores.
  await page.keyboard.press("j");
  await page.keyboard.press("Backspace");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(async () => (await live()).length).toBe(2);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await live()).length).toBe(3);

  // ⌘→ / ⌘← step the week; bare arrows stayed with the cursor.
  const label = page.locator("[data-calendar-range]");
  const before = await label.textContent();
  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await expect(label).not.toHaveText(before ?? "");
  await page.keyboard.press("ControlOrMeta+ArrowLeft");
  await expect(label).toHaveText(before ?? "");

  // Single keys never fire in a field: D typed into a field leaves the week alone.
  const weekToggle = page.getByRole("radio", { name: "Week" });
  await expect(weekToggle).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("j");
  await page.keyboard.press("Enter");
  const titleField = page.getByLabel("Event title");
  await titleField.focus();
  await page.keyboard.press("End");
  await page.keyboard.type("d");
  await expect(weekToggle).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Backspace");
});
