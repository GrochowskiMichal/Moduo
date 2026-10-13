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
 * Tasks v3 TV-TL1 — "rows follow scope; points and spans" (AC9.1–9.4, AC4.3,
 * AC2.3) on the real app, against the local stack:
 *   - All: one row per project (no task rows until one is expanded); a
 *     project with both dates is a solid bar, one without dates an outline
 *     worked out from its tasks;
 *   - inside a project: its sections on their own rows, a range as a band,
 *     an end date as a diamond, each task a point on its due day;
 *   - nothing on the canvas is rotated (46a).
 * And TV-TL2 — "drag, create, keyboard, dependencies" (AC9.6–9.8):
 *   - dragging a point moves its due date (Undo puts it back); ⌥→ a day,
 *     ⌥⇧→ a week; a diamond, a band and a bar's end drag their dates;
 *   - a click on an undated section's row gives it an end date;
 *   - the selected task's line shows, a contradicting date runs backwards
 *     with "Move to …"; moving a blocker offers to move what waits on it;
 *   - "No date · n" opens the panel's No date view, and a task dragged from
 *     there onto the canvas is due that day.
 * Run it like the other Tasks specs:
 *   bun run local:up && bun run env:local
 *   MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8131
 *   E2E_BASE_URL=http://127.0.0.1:8131 bunx playwright test --project=e2e tests/tasks-timeline.spec.ts
 */

let dev: Session;
let ws: { id: string; inboxId: string };
let tag: string;
const dated = { id: crypto.randomUUID(), name: "" };
const undated = { id: crypto.randomUUID(), name: "" };
const design = crypto.randomUUID();
const build = crypto.randomUUID();
// TV-TL2: a section with no dates yet (a click dates it).
const launch = crypto.randomUUID();
const ids = {
  logo: crypto.randomUUID(),
  late: crypto.randomUUID(),
  guide: crypto.randomUUID(),
  // TV-TL2: no date at all (the No date view's).
  kit: crypto.randomUUID(),
  loose: crypto.randomUUID(),
  old: crypto.randomUUID(),
};

/** A date key `days` from today, in this machine's calendar. */
function dayKey(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 900 } });

test.beforeAll(async () => {
  dev = await signIn(DEV);
  ws = await devWorkspace(dev);
  tag = runTag();
  dated.name = `Rebrand ${tag}`;
  undated.name = `Northwind ${tag}`;
  await rpc(dev, "projects_op_create", {
    p_workspace_id: ws.id,
    p_project: {
      id: dated.id,
      name: dated.name,
      position: `zz${tag}a`,
      starts_on: dayKey(-10),
      target_on: dayKey(30),
    },
  });
  await rpc(dev, "projects_op_create", {
    p_workspace_id: ws.id,
    p_project: { id: undated.id, name: undated.name, position: `zz${tag}b` },
  });
  await rpc(dev, "sections_op_create", {
    p_workspace_id: ws.id,
    p_project_id: dated.id,
    p_section: { id: design, name: `Design ${tag}`, starts_on: dayKey(-2), ends_on: dayKey(10) },
  });
  await rpc(dev, "sections_op_create", {
    p_workspace_id: ws.id,
    p_project_id: dated.id,
    p_section: { id: build, name: `Build ${tag}`, ends_on: dayKey(20) },
  });
  const make = (id: string, title: string, bucket: string, extra: object) =>
    rpc(dev, "tasks_op_create", {
      p_workspace_id: ws.id,
      p_task: { id, title, bucket_id: bucket, ...extra },
    });
  await make(ids.logo, `Logo concepts ${tag}`, dated.id, { section_id: design, due_on: dayKey(3) });
  await make(ids.guide, `Guidelines ${tag}`, dated.id, { section_id: build, due_on: dayKey(18) });
  await make(ids.late, `Brand assets ${tag}`, dated.id, { section_id: design, due_on: dayKey(-3) });
  await make(ids.loose, `API contract ${tag}`, undated.id, { due_on: dayKey(5) });
  // Long ago: All's canvas starts months before the dated project's, so a
  // scroll worked out against the wrong one lands far from today.
  await make(ids.old, `Kickoff notes ${tag}`, undated.id, { due_on: dayKey(-220) });
  // TV-TL2: an undated section and task, and "Logo concepts" waiting on
  // "Guidelines", which is due after it (a contradiction, 68b).
  await rpc(dev, "sections_op_create", {
    p_workspace_id: ws.id,
    p_project_id: dated.id,
    p_section: { id: launch, name: `Launch ${tag}` },
  });
  await make(ids.kit, `Press kit ${tag}`, dated.id, { section_id: design });
  await rest(dev, "task_relations", {
    method: "POST",
    body: { workspace_id: ws.id, blocker_task_id: ids.guide, blocked_task_id: ids.logo },
  });
});

test.afterAll(async () => {
  const at = new Date().toISOString();
  for (const id of [dated.id, undated.id]) {
    await rest("service", `tasks?bucket_id=eq.${id}`, {
      method: "PATCH",
      body: { deleted_at: at },
    });
    await rest("service", `sections?project_id=eq.${id}`, {
      method: "PATCH",
      body: { deleted_at: at },
    });
    await rest("service", `buckets?id=eq.${id}`, { method: "PATCH", body: { deleted_at: at } });
  }
});

/** Where today's line sits across the canvas (0 = its left edge, 1 = its right). */
async function todayAcross(page: Page): Promise<number> {
  return page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>("[data-timeline]");
    const line = document.querySelector<HTMLElement>("[data-timeline-today]");
    const name = document.querySelector<HTMLElement>('[data-timeline] [role="rowheader"]');
    if (!scroller || !line || !name) return Number.NaN;
    const box = scroller.getBoundingClientRect();
    const left = box.left + name.getBoundingClientRect().width;
    return (line.getBoundingClientRect().left - left) / (box.right - left);
  });
}

/** Open a sidebar place and switch it to the Timeline. */
async function openTimeline(page: Page, place: string) {
  await page.locator("nav").getByText(place, { exact: true }).first().click();
  const timeline = page.locator("[data-timeline]");
  if ((await timeline.count()) === 0) {
    await page.getByRole("radio", { name: "Timeline view" }).click();
  }
  await expect(timeline).toBeVisible({ timeout: 20_000 });
  return timeline;
}

const row = (page: Page, key: string) => page.locator(`[data-row-key="${key}"]`);

test("rows follow scope; points and spans", async ({ page }) => {
  await signInPage(page, dev, ws.id);
  await page.goto("/tasks");
  await expect(page.locator("nav").getByText(dated.name, { exact: true })).toBeVisible({
    timeout: 20_000,
  });

  // ── All: one row per project, bars, no task rows (AC9.1, AC9.4, AC4.3) ──
  const all = await openTimeline(page, "All");
  await expect(all).toHaveAttribute("data-zoom", "quarter");
  // The shared workspace holds many projects: search lists only this run's
  // (All shows the projects with a match).
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByLabel("Search tasks").fill(tag);
  const datedRow = row(page, `project:${dated.id}`);
  const undatedRow = row(page, `project:${undated.id}`);
  await expect(datedRow).toBeVisible();
  await expect(undatedRow).toBeVisible();
  await expect(all.locator(`[data-row-key="task:${ids.logo}"]`)).toHaveCount(0);
  // Both dates set: a solid bar, its ranged section a segment on it.
  const solid = datedRow.locator('[data-timeline-mark="bar"]');
  await expect(solid).toHaveAttribute("data-solid", "true");
  await expect(solid.locator(`[data-section-id="${design}"]`)).toHaveCount(1);
  // No dates of its own: an outline worked out from its tasks.
  await expect(undatedRow.locator('[data-timeline-mark="bar"]')).not.toHaveAttribute(
    "data-solid",
    /.*/,
  );

  // ▸ expands a project into its sections and tasks.
  await datedRow.getByRole("button", { name: "Unfold" }).click();
  await expect(row(page, `section:${dated.id}:${design}`)).toBeVisible();
  await expect(row(page, `task:${ids.logo}`)).toBeVisible();

  // ── Inside the project: sections as bands and diamonds, tasks as points (AC9.2, AC9.3, AC2.3) ──
  await openTimeline(page, dated.name);
  // It opens at Month (All was at Quarter) with today a quarter of the way across.
  await expect(page.locator("[data-timeline]")).toHaveAttribute("data-zoom", "month");
  await expect.poll(() => todayAcross(page)).toBeGreaterThan(0.15);
  expect(await todayAcross(page)).toBeLessThan(0.35);
  const designRow = row(page, `section:${dated.id}:${design}`);
  const buildRow = row(page, `section:${dated.id}:${build}`);
  await expect(designRow).toContainText(`Design ${tag}`);
  await expect(designRow.locator('[data-timeline-mark="band"]')).toHaveCount(1);
  // An end date only: the diamond sits on the section's own row (68a).
  await expect(buildRow.locator('[data-timeline-mark="diamond"]')).toHaveCount(1);
  await expect(buildRow).toContainText(/by /);
  // A due-only task is a point on its day, with its section's band behind it.
  const logo = row(page, `task:${ids.logo}`);
  await expect(logo.locator('[data-timeline-mark="point"]')).toHaveCount(1);
  await expect(logo.locator('[data-timeline-mark="band"]')).toHaveCount(1);
  await logo.locator('[role="rowheader"]').click();
  await expect(page.getByLabel("Task title")).toHaveValue(`Logo concepts ${tag}`);

  // An open task past its day keeps its place, in the late tone (never moved).
  await expect(
    row(page, `task:${ids.late}`).locator('[data-timeline-mark="point"]'),
  ).toHaveAttribute("data-late", "true");

  // ── The name column: resizable from 200 to 480 px, ⇧[ hides it (AC9.5) ──
  const nameCell = logo.locator('[role="rowheader"]');
  const drag = async (dx: number) => {
    const edge = await page.locator("[data-timeline-resize]").boundingBox();
    if (!edge) throw new Error("no resize edge");
    await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
    await page.mouse.down();
    await page.mouse.move(edge.x + dx / 2, edge.y + edge.height / 2, { steps: 4 });
    await page.mouse.move(edge.x + dx, edge.y + edge.height / 2, { steps: 4 });
    await page.mouse.up();
  };
  await drag(400);
  await expect.poll(async () => (await nameCell.boundingBox())?.width).toBe(480);
  await drag(-400);
  await expect.poll(async () => (await nameCell.boundingBox())?.width).toBe(200);
  await page.locator("[data-timeline]").focus();
  await page.keyboard.press("Shift+BracketLeft");
  await expect.poll(async () => (await nameCell.boundingBox())?.width ?? 0).toBe(0);
  await page.keyboard.press("Shift+BracketLeft");
  await expect.poll(async () => (await nameCell.boundingBox())?.width).toBe(200);

  // ── Due per week: a third header row of counts (AC2.7) ──
  await page.getByRole("button", { name: "Display", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Due per week" }).click();
  await page.keyboard.press("Escape");
  const perWeek = page.locator("[data-timeline-due-per-week]");
  await expect(perWeek).toBeVisible();
  await expect(perWeek.locator("[data-week]").filter({ hasText: /^\d+$/ }).first()).toBeVisible();

  // Back to All and into the project again, the Timeline staying open (each
  // place remembers it): the zoom changes with the place, and today is still
  // a quarter across.
  await page.locator("nav").getByText("All", { exact: true }).first().click();
  await expect(page.locator("[data-timeline]")).toHaveAttribute("data-zoom", "quarter");
  await page.locator("nav").getByText(dated.name, { exact: true }).first().click();
  await expect(page.locator("[data-timeline]")).toHaveAttribute("data-zoom", "month");
  await expect.poll(() => todayAcross(page)).toBeGreaterThan(0.15);
  expect(await todayAcross(page)).toBeLessThan(0.35);

  // ── Nothing is rotated (46a) ──
  const rotated = await page.evaluate(() =>
    [...document.querySelectorAll("[data-timeline] *")].some((el) => {
      const t = getComputedStyle(el).transform;
      if (!t || t === "none") return false;
      const m = /matrix\(([^)]+)\)/.exec(t);
      if (!m) return false;
      const [a, b] = m[1].split(",").map(Number);
      return Math.abs(Math.atan2(b, a)) > 0.01;
    }),
  );
  expect(rotated).toBe(false);
});

/** A task's due day, as the server keeps it. */
async function dueOf(id: string): Promise<string | null> {
  const rows = await rest<Array<{ due_on: string | null }>>(
    "service",
    `tasks?id=eq.${id}&select=due_on`,
  );
  return rows[0]?.due_on ?? null;
}

/** A section's dates, as the server keeps them. */
async function sectionOf(id: string): Promise<string> {
  const rows = await rest<Array<{ starts_on: string | null; ends_on: string | null }>>(
    "service",
    `sections?id=eq.${id}&select=starts_on,ends_on`,
  );
  return `${rows[0]?.starts_on ?? "-"}..${rows[0]?.ends_on ?? "-"}`;
}

/** Press, move in steps, let go: a real pointer drag. */
async function dragBy(page: Page, from: { x: number; y: number }, dx: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y, { steps: 5 });
  await page.mouse.move(from.x + dx, from.y, { steps: 5 });
  await page.mouse.up();
}

async function centerOf(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`nothing at ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Where something is once a smooth scroll has stopped moving it. */
async function settledCenter(page: Page, selector: string) {
  let last = "";
  await expect
    .poll(async () => {
      const at = await centerOf(page, selector);
      const now = `${Math.round(at.x)}:${Math.round(at.y)}`;
      const settled = now === last;
      last = now;
      return settled;
    })
    .toBe(true);
  return centerOf(page, selector);
}

const DAY_WIDTH: Record<string, number> = { week: 120, month: 24, quarter: 10, year: 3 };

/**
 * Select a row and ⇧T (fit the selection): its mark comes into view, the
 * zoom widening only if it has to. Waits for the smooth scroll to settle and
 * answers the day width it ended at.
 */
async function fitRow(page: Page, key: string, mark: string): Promise<number> {
  await row(page, key).locator('[role="rowheader"]').click();
  await page.keyboard.press("Shift+T");
  let last = "";
  await expect
    .poll(async () => {
      const box = await page.locator(`[data-row-key="${key}"] ${mark}`).first().boundingBox();
      const now = box ? `${Math.round(box.x)}:${Math.round(box.width)}` : "none";
      const settled = now === last && now !== "none";
      last = now;
      return settled;
    })
    .toBe(true);
  const zoom = (await page.locator("[data-timeline]").getAttribute("data-zoom")) ?? "month";
  return DAY_WIDTH[zoom] ?? 24;
}

test("drag, create, keyboard, dependencies", async ({ page }) => {
  await signInPage(page, dev, ws.id);
  await page.goto("/tasks");
  await expect(page.locator("nav").getByText(dated.name, { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  // Inside the project, at Month: 24 px a day.
  await openTimeline(page, dated.name);
  await expect(page.locator("[data-timeline]")).toHaveAttribute("data-zoom", "month");
  const DAY = 24;
  const logoPoint = `[data-row-key="task:${ids.logo}"] [data-timeline-mark="point"]`;

  // ── Drag a point: its due date moves; Undo puts it back (AC9.6) ──
  await dragBy(page, await centerOf(page, logoPoint), DAY * 2);
  await expect.poll(() => dueOf(ids.logo)).toBe(dayKey(5));
  await page.getByRole("button", { name: "Undo" }).first().click();
  await expect.poll(() => dueOf(ids.logo)).toBe(dayKey(3));

  // ── The keys: ⌥→ a day, ⌥⇧→ a week, and back (AC9.6) ──
  await row(page, `task:${ids.logo}`).locator('[role="rowheader"]').click();
  await page.keyboard.press("Alt+ArrowRight");
  await expect.poll(() => dueOf(ids.logo)).toBe(dayKey(4));
  await page.keyboard.press("Alt+Shift+ArrowRight");
  await expect.poll(() => dueOf(ids.logo)).toBe(dayKey(11));
  await page.keyboard.press("Alt+Shift+ArrowLeft");
  await expect.poll(() => dueOf(ids.logo)).toBe(dayKey(4));
  await page.keyboard.press("Alt+ArrowLeft");
  await expect.poll(() => dueOf(ids.logo)).toBe(dayKey(3));

  // ── The selected task's line; a date due before what it waits on (AC9.7, 68b) ──
  // "Logo concepts" (in 3 days) waits on "Guidelines" (in 18): the line runs
  // backwards, and its mark offers the day after.
  const line = page.locator(`[data-timeline-dep="${ids.guide}>${ids.logo}"]`);
  await expect(line).toHaveAttribute("data-backwards", "true");
  await row(page, `task:${ids.logo}`).locator("[data-timeline-contradiction]").click();
  await page.getByRole("button", { name: /^Move to / }).click();
  await expect.poll(() => dueOf(ids.logo)).toBe(dayKey(19));
  await expect(line).not.toHaveAttribute("data-backwards", /.*/);
  await expect(row(page, `task:${ids.logo}`).locator("[data-timeline-contradiction]")).toHaveCount(
    0,
  );

  // Moving the blocker later offers to move what waits on it (70), never on
  // its own. ⇧T brings its point into view first (it's off to the right).
  const guidePoint = `[data-row-key="task:${ids.guide}"] [data-timeline-mark="point"]`;
  const point = '[data-timeline-mark="point"]';
  await fitRow(page, `task:${ids.guide}`, point);
  await dragBy(page, await centerOf(page, guidePoint), DAY);
  await expect.poll(() => dueOf(ids.guide)).toBe(dayKey(19));
  expect(await dueOf(ids.logo)).toBe(dayKey(19));
  await page.getByRole("button", { name: "Also move the one that waits on this" }).click();
  await expect.poll(() => dueOf(ids.logo)).toBe(dayKey(20));

  // ── Sections: a diamond, a band (AC9.6) ──
  const diamond = '[data-timeline-mark="diamond"]';
  const buildKey = `section:${dated.id}:${build}`;
  await fitRow(page, buildKey, diamond);
  await dragBy(page, await centerOf(page, `[data-row-key="${buildKey}"] ${diamond}`), -DAY);
  await expect.poll(() => sectionOf(build)).toBe(`-..${dayKey(19)}`);
  const band = '[data-timeline-mark="band"]';
  const designKey = `section:${dated.id}:${design}`;
  await fitRow(page, designKey, band);
  await dragBy(page, await centerOf(page, `[data-row-key="${designKey}"] ${band}`), DAY);
  await expect.poll(() => sectionOf(design)).toBe(`${dayKey(-1)}..${dayKey(11)}`);

  // ── A click on an undated section's row gives it an end date (AC9.6) ──
  await page.keyboard.press("t");
  const today = await settledCenter(page, "[data-timeline-today]");
  const launchRow = await row(page, `section:${dated.id}:${launch}`).boundingBox();
  if (!launchRow) throw new Error("no Launch row");
  // Hovering shows what a click would set.
  await page.mouse.move(today.x + 40, launchRow.y + launchRow.height / 2);
  await expect(
    row(page, `section:${dated.id}:${launch}`).locator("[data-timeline-ghost]"),
  ).toHaveCount(1);
  await page.mouse.click(today.x, launchRow.y + launchRow.height / 2);
  await expect.poll(() => sectionOf(launch)).toBe(`-..${dayKey(0)}`);

  // ── "No date · n" opens the panel's view; a task dragged onto the canvas is due then (AC9.8) ──
  await page.locator("[data-timeline-no-date-open]").click();
  const panel = page.locator("[data-timeline-no-date]");
  await expect(panel).toContainText(`Press kit ${tag}`);
  const kit = await centerOf(page, `[data-no-date-task="${ids.kit}"]`);
  const target = await row(page, `task:${ids.late}`).boundingBox();
  if (!target) throw new Error("no row to drop on");
  // Where today is now that the panel is open.
  const day0 = await settledCenter(page, "[data-timeline-today]");
  await page.mouse.move(kit.x, kit.y);
  await page.mouse.down();
  await page.mouse.move(kit.x - 12, kit.y, { steps: 3 });
  await page.mouse.move(day0.x, target.y + target.height / 2, { steps: 12 });
  await page.mouse.move(day0.x + 1, target.y + target.height / 2, { steps: 2 });
  await page.mouse.up();
  await expect.poll(() => dueOf(ids.kit)).toBe(dayKey(0));
  // It was the place's last undated task: the view says so.
  await expect(page.getByText("Everything here has a date")).toBeVisible();

  // ── The project's bar: its end resizes (AC9.6); ⇧T fits the bar, zooming out ──
  const projectKey = `project:${dated.id}`;
  const dw = await fitRow(page, projectKey, '[data-timeline-mark="bar"]');
  await dragBy(
    page,
    await centerOf(page, `[data-row-key="${projectKey}"] [data-timeline-edge="end"]`),
    dw,
  );
  await expect
    .poll(async () => {
      const rows = await rest<Array<{ target_on: string | null }>>(
        "service",
        `buckets?id=eq.${dated.id}&select=target_on`,
      );
      return rows[0]?.target_on ?? null;
    })
    .toBe(dayKey(31));
});
