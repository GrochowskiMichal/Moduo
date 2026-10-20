// Spike driver: the same six measurements on the real app and on the spike,
// against the LOCAL stack's 10k fixture (bun run perf:seed).
//   bun scripts/spikes/tanstack-db/measure.ts app   http://127.0.0.1:8131
//   bun scripts/spikes/tanstack-db/measure.ts spike http://127.0.0.1:8395
// Every time is taken in the page (performance.now), from the input's first
// event (or navigation start) to the frame that shows the result, like
// e2e/tests/perf/tasks-10k.spec.ts.

import { type BrowserContext, chromium, type Page } from "@playwright/test";
import { rest, signIn, signInPage } from "../../../e2e/tests/support/local-stack";
import { PERF_SEARCH_WORD, PERF_USER, seedPerfFixture } from "../../perf/seed-tasks-10k";

const target = (process.argv[2] ?? "spike") as "app" | "spike";
const base =
  process.argv[3] ?? (target === "app" ? "http://127.0.0.1:8131" : "http://127.0.0.1:8395");
const TRIES = Number(process.env.TRIES ?? 3);
const start = target === "app" ? `${base}/tasks` : `${base}/`;

type Probe = {
  firstRows?: number;
  renders: number;
  rowRenders: number;
  mutations: number;
  opEnd: number[];
  arm: (kind: string, arg: string) => void;
  result?: Promise<{ ms: number; at: number }>;
};

/** In the page: fiber render counter (a DevTools-hook stub), DOM mutation and
 *  network observers, the first-rows clock and the timed-step clock. */
function installProbe() {
  const w = window as unknown as { __probe: Probe; __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown };
  const p: Probe = { renders: 0, rowRenders: 0, mutations: 0, opEnd: [], arm: () => {} };
  w.__probe = p;
  const COMPONENT = new Set([0, 1, 11, 14, 15]); // function, class, forwardRef, memo, simple memo
  const walk = (next: any, prev: any) => {
    if (COMPONENT.has(next.tag) && (!prev || (next.flags & 1) === 1)) p.renders++;
    // A list row's element got new props: its component rendered it again.
    if (
      next.tag === 5 &&
      next.memoizedProps?.["data-list-row"] &&
      next.memoizedProps !== prev?.memoizedProps
    )
      p.rowRenders++;
    if (prev && next.child === prev.child) return;
    for (let c = next.child; c; c = c.sibling) walk(c, c.alternate);
  };
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(),
    supportsFiber: true,
    inject: () => 1,
    onScheduleFiberRoot: () => {},
    onCommitFiberRoot: (_id: number, root: any) => walk(root.current, root.current.alternate),
    onCommitFiberUnmount: () => {},
    onPostCommitFiberRoot: () => {},
    checkDCE: () => {},
  };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries())
      if (e.name.includes("tasks_op_update"))
        p.opEnd.push((e as PerformanceResourceTiming).responseEnd);
  }).observe({ type: "resource", buffered: true });
  const rows = () => [...document.querySelectorAll<HTMLElement>("[data-list-row]")];
  const firstRows = () => {
    if (p.firstRows === undefined && document.querySelector("[data-list-row]")) {
      p.firstRows = performance.now();
      return;
    }
    if (p.firstRows === undefined) requestAnimationFrame(firstRows);
  };
  requestAnimationFrame(firstRows);
  document.addEventListener("DOMContentLoaded", () => {
    new MutationObserver((m) => {
      p.mutations += m.length;
    }).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  });
  const holds: Record<string, (arg: string) => boolean> = {
    // The first row is not the one it was (a project switch).
    changed: (prevFirst) => {
      const r = rows();
      return r.length > 0 && r[0]?.dataset.listRow !== prevFirst;
    },
    matches: (ids) => {
      const want = new Set(ids.split(","));
      const shown = rows();
      return shown.length > 0 && shown.every((r) => want.has(r.dataset.listRow ?? ""));
    },
    // The row shows the new title.
    titled: (arg) => {
      const [id, title] = arg.split("|");
      const el = document.querySelector(`[data-list-row="${id}"] [data-row-title]`);
      return (el?.textContent ?? "").trim() === title;
    },
  };
  p.arm = (kind, arg) => {
    let begun = -1;
    const mark = () => {
      if (begun < 0) begun = performance.now();
    };
    for (const type of ["pointerdown", "keydown", "beforeinput", "input"])
      document.addEventListener(type, mark, { capture: true, once: true });
    p.result = new Promise((resolve, reject) => {
      const limit = performance.now() + 20_000;
      const tick = () => {
        if (begun >= 0 && holds[kind]?.(arg)) {
          requestAnimationFrame(() => resolve({ ms: performance.now() - begun, at: begun }));
          return;
        }
        if (performance.now() > limit) reject(new Error(`never: ${kind} ${arg}`));
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  };
}

async function timed(page: Page, kind: string, input: () => Promise<void>, arg = "") {
  await page.evaluate(
    ([k, a]) => (window as unknown as { __probe: Probe }).__probe.arm(k as string, a as string),
    [kind, arg],
  );
  await input();
  return page.evaluate(
    () =>
      (window as unknown as { __probe: Probe }).__probe.result as Promise<{
        ms: number;
        at: number;
      }>,
  );
}
const probe = <T>(page: Page, f: (p: Probe) => T) =>
  page.evaluate(
    (src) =>
      new Function("p", `return (${src})(p)`)((window as unknown as { __probe: Probe }).__probe),
    f.toString(),
  ) as Promise<T>;

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const out: Record<string, number[] | string> = {};
function report(name: string, xs: number[]) {
  out[name] = xs.map((x) => Math.round(x));
  console.log(
    `${name}: ${xs.map((x) => x.toFixed(0)).join(", ")} (median ${median(xs).toFixed(0)})`,
  );
}

const { workspaceId } = await seedPerfFixture();
const perf = await signIn(PERF_USER);
const browser = await chromium.launch({ headless: process.env.HEADED !== "1" });
const fresh = async (): Promise<BrowserContext> => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  await ctx.addInitScript(installProbe);
  return ctx;
};
const errors = (page: Page) => {
  page.on("pageerror", (e) => console.error("[page error]", e.message));
  page.on(
    "console",
    (m) => m.type() === "error" && console.error("[console]", m.text().slice(0, 300)),
  );
};

/** Waits for rows and returns navigation-start → first rows. */
async function openRows(page: Page): Promise<number> {
  await page.locator("[data-list-row]").first().waitFor({ timeout: 60_000 });
  return probe(page, (p) => p.firstRows ?? -1);
}

/** The spike only: navigation start → every row synced. */
async function spikeSynced(page: Page) {
  if (target !== "spike") return undefined;
  await page.waitForFunction(
    () =>
      (window as never as { __spike?: { timings?: { caughtUp?: number } } }).__spike?.timings
        ?.caughtUp !== undefined,
    undefined,
    { timeout: 120_000 },
  );
  return page.evaluate(
    () =>
      (window as never as { __spike: { timings: unknown; size: () => number } }).__spike.timings,
  );
}

// 1. Cold open (an empty device copy) and 2. warm open (reload, copy kept).
const cold: number[] = [];
const warm: number[] = [];
const coldSynced: unknown[] = [];
const warmSynced: unknown[] = [];
let page!: Page;
for (let k = 0; k < TRIES; k++) {
  const ctx = await fresh();
  page = await ctx.newPage();
  errors(page);
  await signInPage(page, perf, workspaceId);
  await page.goto(start);
  cold.push(await openRows(page));
  coldSynced.push(await spikeSynced(page));
  // Let the rest of the copy land and persist before the reload.
  await page.waitForTimeout(target === "app" ? 8_000 : 3_000);
  await page.reload();
  warm.push(await openRows(page));
  warmSynced.push(await spikeSynced(page));
  if (k < TRIES - 1) await ctx.close();
}
report("cold open → first rows (ms from navigation)", cold);
report("warm open → first rows (ms from navigation)", warm);
if (target === "spike") {
  out.coldSynced = JSON.stringify(coldSynced);
  out.warmSynced = JSON.stringify(warmSynced);
  console.log("cold sync timings", coldSynced);
  console.log("warm sync timings", warmSynced);
}
await page.waitForTimeout(3_000);

const rowsLoc = page.locator("[data-list-row]");
const firstId = async () => (await rowsLoc.first().getAttribute("data-list-row")) ?? "";
const nav = page.getByRole("navigation", { name: "Tasks", exact: true });
const project = (name: string) =>
  nav.getByRole("button", { name: new RegExp(`^${name}( ,|$)`) }).first();

// 3. Project switch: Inbox → a project → another project.
const switches: number[] = [];
for (const name of ["Website", "Billing", "Docs", "Search", "Infra", "Support"].slice(
  0,
  TRIES * 2,
)) {
  const before = await firstId();
  switches.push((await timed(page, "changed", () => project(name).click(), before)).ms);
}
report("project switch", switches);

// 4. Search: the query lands, only the 20 matches show.
const matching = await rest<Array<{ id: string }>>(
  "service",
  `tasks?workspace_id=eq.${workspaceId}&deleted_at=is.null&or=(title.ilike.*${PERF_SEARCH_WORD}*,description.ilike.*${PERF_SEARCH_WORD}*)&select=id`,
);
const ids = matching.map((m) => m.id).join(",");
if (target === "app") {
  await page
    .getByRole("button", { name: /^All\b/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Search", exact: true }).click();
}
const field = page.getByLabel("Search tasks");
const searches: number[] = [];
for (let k = 0; k < TRIES; k++) {
  searches.push((await timed(page, "matches", () => field.fill(PERF_SEARCH_WORD), ids)).ms);
  await field.fill("");
  await page.waitForFunction(() => document.querySelectorAll("[data-list-row]").length > 20);
}
report(`search "${PERF_SEARCH_WORD}" (${matching.length} matches)`, searches);

// 5. Single-field edit round trip and 6. renders/DOM mutations on that edit.
await project("Website").click();
await page.waitForTimeout(500);
const paints: number[] = [];
const trips: number[] = [];
const renders: number[] = [];
const rowRenders: number[] = [];
const mutations: number[] = [];
for (let k = 0; k < TRIES; k++) {
  const row = rowsLoc.nth(2 + k);
  const id = (await row.getAttribute("data-list-row")) ?? "";
  await row.locator("[data-row-title]").click();
  const box = page.getByLabel("Task title");
  await box.waitFor();
  const original = await box.inputValue();
  const title = `${original.replace(/ ✎\d+$/, "")} ✎${Date.now() % 100000}`;
  await box.fill(title);
  await page.waitForTimeout(300);
  const before = await probe(page, (p) => ({
    r: p.renders,
    rr: p.rowRenders,
    m: p.mutations,
    ops: p.opEnd.length,
  }));
  const r = await timed(page, "titled", () => box.press("Tab"), `${id}|${title}`);
  paints.push(r.ms);
  await page.waitForFunction(
    (n) => (window as never as { __probe: Probe }).__probe.opEnd.length > n,
    before.ops,
    { timeout: 20_000 },
  );
  const end = await probe(page, (p) => p.opEnd[p.opEnd.length - 1] ?? 0);
  trips.push(end - r.at);
  await page.waitForTimeout(1_000); // the server's row and any echo land
  const after = await probe(page, (p) => ({ r: p.renders, rr: p.rowRenders, m: p.mutations }));
  renders.push(after.r - before.r);
  rowRenders.push(after.rr - before.rr);
  mutations.push(after.m - before.m);
  // Put the title back (server-side, so it is not counted).
  await rest("service", `tasks?id=eq.${id}`, { method: "PATCH", body: { title: original } });
  await page.waitForTimeout(800);
}
report("edit → optimistic paint", paints);
report("edit → server answer (tasks_op_update responseEnd)", trips);
report("components rendered per edit (input → +1 s after answer)", renders);
report("list rows re-rendered per edit", rowRenders);
report("DOM mutation records per edit", mutations);

const dom = await page.evaluate(() => document.getElementsByTagName("*").length);
out.domNodes = String(dom);
console.log(`DOM elements on the project view: ${dom}`);
console.log(`RESULT ${target} ${JSON.stringify(out)}`);
await browser.close();
