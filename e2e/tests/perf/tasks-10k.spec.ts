import { expect, type Locator, type Page, test } from "@playwright/test";

import {
  PERF_SEARCH_WORD,
  PERF_TASKS,
  PERF_USER,
  seedPerfFixture,
} from "../../../scripts/perf/seed-tasks-10k";
import { rest, rpc, type Session, signIn, signInPage } from "../support/local-stack";

/**
 * Tasks v3 AC12.3 + AC12.4 — the 200 ms budget on the 10,000-task fixture
 * (TV-D11b, spec §Assumptions #8), against the LOCAL stack only:
 *   bun run local:up && bun run env:local
 *   MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8131
 *   E2E_BASE_URL=http://127.0.0.1:8131 bun run perf
 * AC1's warm-open budget holds a production build: `bun run build` in apps/app,
 * `rsbuild preview --port 8132`, then E2E_BASE_URL=http://127.0.0.1:8132 PERF_PROD=1.
 * (`bun run perf` seeds the fixture first: `bun run perf:seed`.)
 *
 * Each step is a real input (Playwright's click or fill), timed inside the
 * page from the input's first event to the frame that shows its result:
 * opening a task (the panel shows its title), searching (the List shows only
 * matches) and switching views (List → Board → List). The median of three
 * tries must stay under BUDGET_MS. Long lists and columns draw only the rows
 * on screen, and a card still drags out of a 1,200-card column.
 *
 * The Timeline is rebuilt by TV-TL1 with its own budget (AC9.9,
 * tests/perf/tasks-timeline-2k.spec.ts); its switch time is logged here only.
 */

const BUDGET_MS = 200;
const TRIES = 3;

let perf: Session;
let workspaceId: string;

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 900 }, locale: "en-US" });

test.beforeAll(async () => {
  test.setTimeout(180_000);
  ({ workspaceId } = await seedPerfFixture());
  perf = await signIn(PERF_USER);
});

type PerfWindow = Window & {
  __perfArm?: (kind: string, arg: string) => void;
  __perfResult?: Promise<number>;
  /** When the first List row was drawn (performance.now()). */
  __firstRows?: number;
};

/** In the page: what each measured step waits for, and the clock. */
function installClock() {
  const w = window as PerfWindow;
  const rows = () => [...document.querySelectorAll<HTMLElement>("[data-list-row]")];
  // The frame that first shows a List row (AC1's "paint from device").
  const watch = () => {
    if (document.querySelector("[data-list-row]")) {
      requestAnimationFrame(() => {
        w.__firstRows ??= performance.now();
      });
      return;
    }
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
  const holds: Record<string, (arg: string) => boolean> = {
    // The panel shows the task that was clicked.
    panel: (title) =>
      (document.querySelector('[aria-label="Task title"]') as HTMLTextAreaElement | null)?.value ===
      title,
    // The Board is up: a card is drawn and the List is gone.
    board: () =>
      document.querySelector('[data-task-id][role="button"]') !== null &&
      document.querySelector("[data-list-row]") === null,
    // The List is up: a row is drawn and the Board is gone.
    list: () =>
      document.querySelector("[data-list-row]") !== null &&
      document.querySelector('[data-task-id][role="button"]') === null,
    // The List's first row is another task than `arg` (a project switch).
    changed: (before) => {
      const first = document.querySelector<HTMLElement>("[data-list-row]");
      return !!first && first.dataset.listRow !== before;
    },
    // The List shows only the matching tasks (`ids`, comma-separated).
    matches: (ids) => {
      const want = new Set(ids.split(","));
      const shown = rows();
      return shown.length > 0 && shown.every((r) => want.has(r.dataset.listRow ?? ""));
    },
  };
  w.__perfArm = (kind, arg) => {
    let start = -1;
    const mark = () => {
      if (start < 0) start = performance.now();
    };
    for (const type of ["pointerdown", "keydown", "beforeinput", "input"]) {
      document.addEventListener(type, mark, { capture: true, once: true });
    }
    w.__perfResult = new Promise<number>((resolve, reject) => {
      const limit = performance.now() + 15_000;
      const tick = () => {
        if (start >= 0 && holds[kind]?.(arg)) {
          // The frame that shows it.
          requestAnimationFrame(() => resolve(performance.now() - start));
          return;
        }
        if (performance.now() > limit) reject(new Error(`never: ${kind} ${arg}`));
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  };
}

/** Time one real input until `kind` holds in the page. */
async function timed(
  page: Page,
  kind: string,
  input: () => Promise<void>,
  arg = "",
): Promise<number> {
  await page.evaluate(([k, a]) => (window as PerfWindow).__perfArm?.(k, a), [kind, arg]);
  await input();
  return page.evaluate(() => (window as PerfWindow).__perfResult as Promise<number>);
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

function report(name: string, xs: number[]) {
  console.log(
    `${name}: ${xs.map((x) => x.toFixed(0)).join(", ")} ms (median ${median(xs).toFixed(0)})`,
  );
}

/** Signs in and opens All once the rest of the tasks (Done, Won't do) is in. */
async function openAll(page: Page) {
  await page.addInitScript(installClock);
  await signInPage(page, perf, workspaceId);
  await page.goto("/tasks");
  await expect(page.getByRole("navigation", { name: "Location" })).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("button", { name: /^All\b/ })
    .first()
    .click();
  await expect(page.locator("[data-list-row]").first()).toBeVisible({ timeout: 30_000 });
  // The closed tasks arrive after the open ones; let the store settle.
  await page.waitForTimeout(3_000);
}

/** Display → Group by → `label`. */
async function setGroupBy(page: Page, label: string) {
  await page.getByRole("button", { name: "Display" }).click();
  await page.getByRole("combobox", { name: "Group by" }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Display options" })).toHaveCount(0);
}

const listRows = (page: Page) => page.locator("[data-list-row]");
const cards = (page: Page) => page.locator('[data-task-id][role="button"]');

test("the fixture is in place", async () => {
  const rows = await rest<Array<{ id: string }>>(
    "service",
    `tasks?workspace_id=eq.${workspaceId}&deleted_at=is.null&select=id&limit=1&offset=${PERF_TASKS - 1}`,
  );
  expect(rows).toHaveLength(1);
});

test("AC12.3 — opening a task, searching and switching views stay under 200 ms", async ({
  page,
}) => {
  await openAll(page);

  // Open a task: a click on a row until the panel shows it.
  const opens: number[] = [];
  for (let k = 0; k < TRIES; k++) {
    const row = listRows(page).nth(4 + k * 3);
    const title = ((await row.locator("[data-row-title]").textContent()) ?? "").trim();
    opens.push(await timed(page, "panel", () => row.locator("[data-row-title]").click(), title));
  }
  report("open a task", opens);

  // Switch views: List → Board → List.
  const switches: number[] = [];
  for (let k = 0; k < TRIES; k++) {
    switches.push(
      await timed(page, "board", () => page.getByRole("radio", { name: "Board view" }).click()),
    );
    switches.push(
      await timed(page, "list", () => page.getByRole("radio", { name: "List view" }).click()),
    );
  }
  report("switch views", switches);

  // The Timeline (TV-TL1's): logged, not held to the budget here.
  const timeline = performance.now();
  await page.getByRole("radio", { name: "Timeline view" }).click();
  await expect(page.locator("[data-list-row]")).toHaveCount(0);
  console.log(
    `switch to Timeline (not budgeted): ~${(performance.now() - timeline).toFixed(0)} ms`,
  );
  await page.getByRole("radio", { name: "List view" }).click();
  await expect(listRows(page).first()).toBeVisible();

  // Search: the query lands, the List shows only matches (in its title or
  // its description: 20 open tasks of the fixture).
  const matching = await rest<Array<{ id: string }>>(
    "service",
    `tasks?workspace_id=eq.${workspaceId}&deleted_at=is.null&or=(title.ilike.*${PERF_SEARCH_WORD}*,description.ilike.*${PERF_SEARCH_WORD}*)&select=id`,
  );
  expect(matching).toHaveLength(20);
  const ids = matching.map((m) => m.id).join(",");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const field = page.getByLabel("Search tasks");
  const searches: number[] = [];
  for (let k = 0; k < TRIES; k++) {
    searches.push(await timed(page, "matches", () => field.fill(PERF_SEARCH_WORD), ids));
    await field.fill("");
    await expect.poll(() => listRows(page).count()).toBeGreaterThan(20);
  }
  report("search", searches);

  // The server's search (`tasks_search`), which the views ask only while the
  // copy can't answer alone: timed at 10,000 tasks, a rare word and a common one.
  for (const q of [PERF_SEARCH_WORD, "the"]) {
    const t0 = performance.now();
    const ids = await rpc<string[]>(perf, "tasks_search", {
      p_workspace_id: workspaceId,
      p_query: q,
      p_limit: 200,
    });
    const ms = performance.now() - t0;
    console.log(`server search "${q}": ${ids.length} ids in ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(BUDGET_MS);
  }

  expect(median(opens)).toBeLessThan(BUDGET_MS);
  expect(median(switches)).toBeLessThan(BUDGET_MS);
  expect(median(searches)).toBeLessThan(BUDGET_MS);
});

test("AC1 — a warm open paints the Inbox from the device copy in 150 ms", async ({ page }) => {
  await page.addInitScript(installClock);
  await signInPage(page, perf, workspaceId);
  await page.goto("/tasks");
  await expect(listRows(page).first()).toBeVisible({ timeout: 30_000 });
  // Let the whole copy land on the device before reopening from it.
  await page.waitForTimeout(8_000);
  const fromStore: number[] = [];
  const fromNavigation: number[] = [];
  for (let k = 0; k < 5; k++) {
    await page.reload();
    await expect(listRows(page).first()).toBeVisible({ timeout: 30_000 });
    const [store, nav, read, shown] = await page.evaluate(async () => {
      const w = window as PerfWindow;
      while (w.__firstRows === undefined) await new Promise((r) => requestAnimationFrame(r));
      const mark = performance.getEntriesByName("moduo:tasks-store-start")[0];
      const at = (n: string) =>
        (performance.getEntriesByName(n)[0]?.startTime ?? 0) - (mark?.startTime ?? 0);
      return [
        w.__firstRows - (mark?.startTime ?? 0),
        w.__firstRows,
        at("moduo:tasks-copy-read"),
        at("moduo:tasks-copy-shown"),
      ];
    });
    console.log(
      `  device copy read ${read?.toFixed(0)} · shown ${shown?.toFixed(0)} · first rows ${store.toFixed(0)} ms`,
    );
    fromStore.push(store);
    fromNavigation.push(nav);
  }
  // The store opens once the app has booted (the bundle, sign-in): the clock
  // starts there, so it holds what the device copy costs to paint. The budget
  // is the shipped build's: point E2E_BASE_URL at `rsbuild preview` and set
  // PERF_PROD=1. A dev server draws React's dev build, about twice as slow
  // (TS-3b measured 310 ms there against 151 ms built), so it only logs.
  report("warm open → first rows from the store's start", fromStore);
  report("warm open → first rows from navigation (not budgeted)", fromNavigation);
  if (process.env.PERF_PROD === "1") expect(median(fromStore)).toBeLessThanOrEqual(150);
});

test("project switch: Inbox → a project → another, under 200 ms", async ({ page }) => {
  await page.addInitScript(installClock);
  await signInPage(page, perf, workspaceId);
  await page.goto("/tasks");
  await expect(listRows(page).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3_000);
  const nav = page.getByRole("navigation", { name: "Tasks", exact: true });
  const switches: number[] = [];
  for (const name of ["Website", "Billing", "Docs", "Search", "Docs", "Website"]) {
    const before = (await listRows(page).first().getAttribute("data-list-row")) ?? "";
    switches.push(
      await timed(
        page,
        "changed",
        () =>
          nav
            .getByRole("button", { name: new RegExp(`^${name} ,`) })
            .first()
            .click(),
        before,
      ),
    );
  }
  report("project switch", switches);
  expect(median(switches)).toBeLessThan(BUDGET_MS);
});

test("AC12.4 — long lists and columns draw only what's on screen", async ({ page }) => {
  await openAll(page);
  // All, ungrouped: every open task in one list (1,900 rows and their subtasks).
  await setGroupBy(page, "None");
  const grid = page.getByRole("grid");
  await expect(listRows(page).first()).toBeVisible();
  const drawn = await listRows(page).count();
  expect(drawn).toBeGreaterThan(10);
  expect(drawn).toBeLessThan(80);
  // The scroller is as tall as the whole list.
  const height = await grid.evaluate((el) => el.scrollHeight);
  expect(height).toBeGreaterThan(1_500 * 28);

  // Scrolling to the end draws the end (and keeps drawing only a screenful).
  await grid.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await expect.poll(() => listRows(page).count()).toBeLessThan(80);
  const lastTitle = await listRows(page).last().textContent();
  expect(lastTitle).toBeTruthy();

  // The Board grouped by status: To do holds 1,200 cards, a screenful is drawn.
  await page.getByRole("radio", { name: "Board view" }).click();
  await expect(cards(page).first()).toBeVisible();
  expect(await cards(page).count()).toBeLessThan(120);
});

test("AC12.4 — a card drags out of a 1,200-card column", async ({ page }) => {
  await openAll(page);
  await page.getByRole("radio", { name: "Board view" }).click();
  // The Board's own columns (TV-U11): the panel's section also says "To do"
  // once a task is selected there.
  const todo = page.locator('section[data-board-column="To do"]');
  const progress = page.locator('section[data-board-column="In progress"]');
  // Scroll the To do column well down, then drag a card from there.
  const scroller = todo.locator("> div").last();
  await scroller.evaluate((el) => el.scrollTo({ top: 20_000 }));
  await page.waitForTimeout(300);
  // The card in the middle of the column's screenful (cards above and below
  // it are drawn too, off screen).
  const taskId = await scroller.evaluate((el) => {
    const middle = el.getBoundingClientRect().top + el.clientHeight / 2;
    let best: { id: string; d: number } | null = null;
    for (const c of el.querySelectorAll<HTMLElement>('[data-task-id][role="button"]')) {
      const r = c.getBoundingClientRect();
      const d = Math.abs(r.top + r.height / 2 - middle);
      if (!best || d < best.d) best = { id: c.dataset.taskId ?? "", d };
    }
    return best?.id ?? "";
  });
  expect(taskId).not.toBe("");
  const card = todo.locator(`[data-task-id="${taskId}"]`);
  await drag(page, card, progress.locator("> div").last());
  await expect
    .poll(async () => {
      const [row] = await rest<Array<{ status_category: string }>>(
        "service",
        `tasks?id=eq.${taskId}&select=status_category`,
      );
      return row?.status_category;
    })
    .toBe("in_progress");
  // Put the fixture back.
  await rest("service", `tasks?id=eq.${taskId}`, {
    method: "PATCH",
    body: { status: "todo" },
  });
});

test("a project added or renamed never blocks the page for 200 ms (rows don't carry the project list)", async ({
  page,
}) => {
  await openAll(page);
  // Every task made a little busy: the List, then the Board.
  for (const view of ["List view", "Board view"]) {
    await page.getByRole("radio", { name: view }).click();
    await page.waitForTimeout(500);
    // Long tasks (over 50 ms) on the main thread from here on.
    await page.evaluate(() => {
      const w = window as Window & { __longest?: number };
      w.__longest = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          w.__longest = Math.max(w.__longest ?? 0, entry.duration);
        }
      }).observe({ type: "longtask" });
    });
    const name = `Perf project ${Date.now()}`;
    const [made] = await rest<Array<{ id: string }>>(perf, "buckets", {
      method: "POST",
      body: { workspace_id: workspaceId, owner_id: perf.user.id, name, position: "zz" },
    });
    try {
      await expect(page.getByRole("button", { name, exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await rest(perf, `buckets?id=eq.${made?.id}`, {
        method: "PATCH",
        body: { name: `${name} renamed` },
      });
      await expect(page.getByRole("button", { name: `${name} renamed`, exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await page.waitForTimeout(300);
      const longest = await page.evaluate(
        () => (window as Window & { __longest?: number }).__longest ?? 0,
      );
      console.log(
        `${view}: longest main-thread task around a project change: ${longest.toFixed(0)} ms`,
      );
      expect(longest).toBeLessThan(BUDGET_MS);
    } finally {
      await rest("service", `buckets?id=eq.${made?.id}`, { method: "DELETE" });
    }
  }
});

async function drag(page: Page, from: Locator, to: Locator) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("no box");
  const start = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const end = { x: b.x + b.width / 2, y: b.y + 60 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 4, start.y + 4, { steps: 2 });
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.waitForTimeout(120);
  await page.mouse.move(end.x, end.y + 1);
  await page.waitForTimeout(120);
  await page.mouse.up();
}
