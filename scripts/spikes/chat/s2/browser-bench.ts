// CV-0 spike 2, pass bars 1, 2, 4 and the measured choices of 6, in a real
// Chromium (Playwright's full Chromium build, new headless) and, with
// --webkit, Playwright's WebKit (informational: Tauri's macOS webview).
//
//   1  cold open: newest 50 of a 10,000-message conversation, IndexedDB →
//      DOM → painted, ≤ 100 ms; 20 browser relaunches (and 20 reloads, and
//      20 reloads at 4× CPU throttle)
//   2  500 rows in one transaction, main-thread share ≤ 8 ms; 20 runs; with
//      the cap's eviction in the same transaction, from a worker, and at 4×
//   4  heap with 1,500 messages in memory ≤ +50 MB (CDP heap usage after GC)
//   6  compound key vs id key, cursor walk vs advance+getAll, Tasks' whole
//      record per workspace, a second database next to an open one, storage
//
// Other builders run browsers on the same Mac: every browser session has a
// deadline and is retried in a fresh process when it misses it.

import { readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type BrowserContext, chromium, type Page, webkit } from "@playwright/test";

import { stats } from "./db";

const WS = "11111111-1111-4111-a111-111111111111";
const MAIN = "22222222-2222-4222-a222-222222222222"; // 10,000 messages
const SMALL = "33333333-3333-4333-a333-333333333333"; // 500 (at the cap)
const OTHERS = Array.from(
  { length: 38 },
  (_, i) => `44444444-4444-4444-a444-${String(i).padStart(12, "0")}`,
);
const START = Date.UTC(2025, 0, 1) * 1000;
const LATER = Date.UTC(2026, 6, 1) * 1000; // write runs land after the seeded rows
const RUNS = 20;
type Engine = "chromium" | "webkit";

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>spike 2</title>
<style>body{margin:0;font:15px/1.4 system-ui,sans-serif}.row{padding:6px 16px}.head{color:gray;font-size:12px}</style>
</head><body><div id="stream"></div><script type="module" src="/main.js"></script></body></html>`;

export async function buildPage(): Promise<Record<string, string>> {
  const dir = new URL("./page/", import.meta.url).pathname;
  const out = await Bun.build({
    entrypoints: [join(dir, "main.ts"), join(dir, "worker.ts")],
    target: "browser",
    format: "esm",
  });
  if (!out.success) throw new Error(out.logs.map(String).join("\n"));
  const files: Record<string, string> = { "/": HTML };
  for (const a of out.outputs) files[`/${a.path.split("/").pop()}`] = await a.text();
  return files;
}

export function log(...parts: unknown[]): void {
  console.error(`[${new Date().toISOString().slice(11, 19)}]`, ...parts);
}

function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what}: no answer in ${ms} ms`)), ms);
    }),
  ]);
}

export async function launch(
  engine: Engine,
  dir: string,
  files: Record<string, string>,
): Promise<BrowserContext> {
  const ctx =
    engine === "chromium"
      ? await chromium.launchPersistentContext(dir, {
          channel: "chromium",
          headless: true,
          timeout: 20_000,
        })
      : await webkit.launchPersistentContext(dir, { headless: true, timeout: 20_000 });
  await ctx.route("http://spike.local/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = files[path];
    if (body === undefined) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({
      status: 200,
      contentType: path.endsWith(".js") ? "text/javascript" : "text/html",
      body,
    });
  });
  return ctx;
}

/**
 * Run `fn` in a fresh browser process on the persistent profile, within a
 * deadline; on any failure close, kill what's left of that profile's
 * processes and run it again (at most four tries).
 */
async function session<T>(
  engine: Engine,
  dir: string,
  files: Record<string, string>,
  what: string,
  fn: (page: Page, ctx: BrowserContext) => Promise<T>,
  deadlineMs = 240_000,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    let ctx: BrowserContext | null = null;
    try {
      ctx = await within(launch(engine, dir, files), 30_000, `${what}: launch`);
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      const r = await within(fn(page, ctx), deadlineMs, what);
      await within(ctx.close(), 15_000, `${what}: close`);
      return r;
    } catch (e) {
      if (attempt >= 3) throw e;
      log(`${what}: retry ${attempt + 1} (${String(e).split("\n")[0].slice(0, 160)})`);
      if (ctx) await within(ctx.close(), 10_000, "close").catch(() => {});
      Bun.spawnSync(["pkill", "-f", `user-data-dir=${dir}`]);
      await Bun.sleep(2000);
    }
  }
}

type Cold = Record<string, number | null | boolean>;

function coldUrl(q: Record<string, string>): string {
  return `http://spike.local/?mode=cold&${new URLSearchParams(q)}`;
}

async function coldResult(page: Page, url: string): Promise<Cold> {
  await page.goto(url);
  await page.waitForFunction(() => (window as unknown as { __result?: unknown }).__result, null, {
    timeout: 20_000,
  });
  const r = (await page.evaluate(() => (window as unknown as { __result: Cold }).__result)) as Cold;
  if ("error" in r) throw new Error(String(r.error));
  return r;
}

function summarize(runs: Cold[]): Record<string, unknown> {
  const pick = (k: string) =>
    runs.map((r) => r[k]).filter((v): v is number => typeof v === "number");
  const out: Record<string, unknown> = { rows: runs[0]?.rows };
  for (const k of [
    "totalMs",
    "navToFcpMs",
    "navToPaintedMs",
    "preopenMs",
    "openMs",
    "readMs",
    "renderMs",
    "paintMs",
  ]) {
    const v = pick(k);
    if (v.length) out[k] = stats(v);
  }
  return out;
}

function writeStats(r: { runs: Record<string, number>[] }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(r.runs[0])) out[k] = stats(r.runs.map((x) => x[k]));
  return out;
}

async function heapUsed(page: Page): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  for (let i = 0; i < 3; i += 1) await cdp.send("HeapProfiler.collectGarbage");
  const h = (await cdp.send("Runtime.getHeapUsage")) as { usedSize: number };
  await cdp.detach();
  return h.usedSize;
}

async function throttle(page: Page, rate: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
}

/** Bytes on disk under the profile's IndexedDB folder. */
function idbBytes(dir: string): number {
  const walk = (p: string): number => {
    const s = statSync(p);
    if (!s.isDirectory()) return s.size;
    return readdirSync(p).reduce((n, f) => n + walk(join(p, f)), 0);
  };
  for (const sub of ["Default/IndexedDB", "IndexedDB"]) {
    try {
      return walk(join(dir, sub));
    } catch {
      // the other engine's layout
    }
  }
  return 0;
}

const mb = (b: number) => Math.round((b / 1024 / 1024) * 100) / 100;

function save(outDir: string, engine: Engine, res: unknown): void {
  writeFileSync(join(outDir, `partial-${engine}.json`), JSON.stringify(res, null, 2));
}

async function benchEngine(engine: Engine, outDir: string, files: Record<string, string>) {
  const dir = join(outDir, `${engine}-profile`);
  rmSync(dir, { recursive: true, force: true });
  const res: Record<string, unknown> = { engine };
  const go = async (page: Page) => {
    await page.goto("http://spike.local/");
  };

  // ── Seed the device copies (two layouts + Tasks' whole record) ──────────
  log(engine, "seeding");
  const convs = [
    { id: MAIN, count: 10_000, seed: 1 },
    { id: SMALL, count: 500, seed: 2 },
    ...OTHERS.map((id, i) => ({ id, count: 500, seed: 10 + i })),
  ];
  const seeded: Record<string, unknown> = {};
  const disk: Record<string, number> = { empty: idbBytes(dir) };
  for (const layout of ["compound", "byId"] as const) {
    seeded[layout] = await session(engine, dir, files, `seed ${layout}`, async (page) => {
      await go(page);
      res.userAgent ??= await page.evaluate(() => navigator.userAgent);
      return page.evaluate((o) => window.spike.seed(o), {
        db: `spike-${layout}`,
        layout,
        ws: WS,
        convs,
        batch: 500,
        startAt: START,
      });
    });
    disk[layout] = idbBytes(dir);
  }
  seeded.whole = await session(engine, dir, files, "seed whole", async (page) => {
    await go(page);
    return page.evaluate((o) => window.spike.wholeRecordWrite(o), {
      db: "spike-whole",
      ws: WS,
      conv: MAIN,
      count: 10_000,
      startAt: START,
    });
  });
  disk.whole = idbBytes(dir);
  res.seeded = seeded;
  res.storage = {
    rowsPerLayout: 29_500,
    compoundBytes: disk.compound - disk.empty,
    byIdBytes: disk.byId - disk.compound,
    compoundBytesPerMessage: Math.round((disk.compound - disk.empty) / 29_500),
    byIdBytesPerMessage: Math.round((disk.byId - disk.compound) / 29_500),
    note: "on-disk growth of the profile's IndexedDB folder after each seed (LevelDB in Chromium: compressed, before compaction)",
  };
  save(outDir, engine, res);

  // ── Bar 1: cold opens, each a fresh browser process ────────────────────
  const main = { db: "spike-compound", layout: "compound", ws: WS, conv: MAIN };
  const configs: { name: string; q: Record<string, string> }[] = [
    { name: "compound · advance+getAll · 10,000", q: { ...main, method: "advance" } },
    { name: "compound · cursor walk · 10,000", q: { ...main, method: "cursor" } },
    {
      name: "byId · advance+getAll · 10,000",
      q: { ...main, db: "spike-byId", layout: "byId", method: "advance" },
    },
    {
      name: "compound · advance+getAll · 500 (capped)",
      q: { ...main, conv: SMALL, method: "advance" },
    },
    {
      name: "compound · advance+getAll · 10,000 · after another database of the origin is open",
      q: { ...main, method: "advance", preopen: "spike-whole-small" },
    },
    { name: "Tasks' whole record · 10,000", q: { db: "spike-whole", ws: WS, whole: "1" } },
  ];
  // The pre-opened database stands in for Tasks' moduo-sync (open at boot).
  await session(engine, dir, files, "seed preopen", async (page) => {
    await go(page);
    await page.evaluate((o) => window.spike.wholeRecordWrite(o), {
      db: "spike-whole-small",
      ws: WS,
      conv: MAIN,
      count: 10,
      startAt: START,
    });
  });
  const relaunch: Record<string, unknown> = {};
  for (const c of engine === "chromium" ? configs : [configs[0], configs[4], configs[5]]) {
    log(engine, "cold relaunch:", c.name);
    const runs: Cold[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      runs.push(
        await session(
          engine,
          dir,
          files,
          `cold ${i}`,
          (page) => coldResult(page, coldUrl(c.q)),
          30_000,
        ),
      );
    }
    relaunch[c.name] = summarize(runs);
    res.coldRelaunch = relaunch;
    save(outDir, engine, res);
  }

  log(engine, "cold reloads");
  res.coldReload = await session(engine, dir, files, "reloads", async (page) => {
    const reload: Record<string, unknown> = {};
    const runs: Cold[] = [];
    for (let i = 0; i < RUNS; i += 1) runs.push(await coldResult(page, coldUrl(configs[0].q)));
    reload[configs[0].name] = summarize(runs);
    if (engine === "chromium") {
      await throttle(page, 4);
      const slow: Cold[] = [];
      for (let i = 0; i < RUNS; i += 1) slow.push(await coldResult(page, coldUrl(configs[0].q)));
      reload[`${configs[0].name} · 4× CPU throttle`] = summarize(slow);
    }
    return reload;
  });
  save(outDir, engine, res);

  // ── Bar 2: 500 rows in one transaction ─────────────────────────────────
  log(engine, "writes");
  const writes: {
    name: string;
    fn: "write500" | "write500Worker";
    db: string;
    layout: "compound" | "byId";
    conv: string;
    cap?: number;
    rate?: number;
  }[] = [
    {
      name: "compound · 500 new rows",
      fn: "write500",
      db: "spike-compound",
      layout: "compound",
      conv: MAIN,
    },
    {
      name: "compound · 500 rows + evict to 500 in the same transaction",
      fn: "write500",
      db: "spike-compound",
      layout: "compound",
      conv: SMALL,
      cap: 500,
    },
    { name: "byId · 500 new rows", fn: "write500", db: "spike-byId", layout: "byId", conv: MAIN },
    {
      name: "byId · 500 rows + evict to 500 in the same transaction",
      fn: "write500",
      db: "spike-byId",
      layout: "byId",
      conv: SMALL,
      cap: 500,
    },
    {
      name: "compound · 500 rows posted to a worker",
      fn: "write500Worker",
      db: "spike-compound",
      layout: "compound",
      conv: OTHERS[0],
    },
  ];
  if (engine === "chromium") {
    writes.push(
      {
        name: "compound · 500 new rows · 4× CPU throttle",
        fn: "write500",
        db: "spike-compound",
        layout: "compound",
        conv: OTHERS[1],
        rate: 4,
      },
      {
        name: "compound · 500 rows posted to a worker · 4× CPU throttle",
        fn: "write500Worker",
        db: "spike-compound",
        layout: "compound",
        conv: OTHERS[2],
        rate: 4,
      },
    );
  }
  const write: Record<string, unknown> = {};
  for (const w of writes) {
    write[w.name] = writeStats(
      await session(engine, dir, files, w.name, async (page) => {
        await go(page);
        if (w.rate) await throttle(page, w.rate);
        const o = {
          db: w.db,
          layout: w.layout,
          ws: WS,
          conv: w.conv,
          runs: RUNS,
          cap: w.cap,
          startAt: LATER,
        };
        return w.fn === "write500"
          ? page.evaluate((x) => window.spike.write500(x), o)
          : page.evaluate((x) => window.spike.write500Worker(x), o);
      }),
    );
    res.write = write;
    save(outDir, engine, res);
  }
  write["Tasks' whole record · 10,000 rows rewritten"] = writeStats(
    await session(engine, dir, files, "whole writes", async (page) => {
      await go(page);
      const runs: Record<string, number>[] = [];
      for (let i = 0; i < 5; i += 1) {
        runs.push(
          await page.evaluate((o) => window.spike.wholeRecordWrite(o), {
            db: "spike-whole",
            ws: WS,
            conv: MAIN,
            count: 10_000,
            startAt: START,
          }),
        );
      }
      return { runs };
    }),
  );
  res.write = write;
  save(outDir, engine, res);

  // ── Bar 4: heap with 1,500 messages in memory (Chromium only: CDP) ─────
  if (engine === "chromium") {
    log(engine, "heap");
    res.heap = await session(engine, dir, files, "heap", async (page) => {
      await go(page);
      const base = await heapUsed(page);
      await page.evaluate((o) => window.spike.heapFillFromDevice(o), {
        db: "spike-compound",
        layout: "compound" as const,
        ws: WS,
        conv: MAIN,
        n: 1500,
      });
      const fromDevice = await heapUsed(page);
      await page.evaluate(() => window.spike.release());
      const released = await heapUsed(page);
      await page.evaluate((o) => window.spike.heapFillMade(o), {
        ws: WS,
        conv: MAIN,
        n: 1500,
        bodyChars: 8000,
      });
      const worst = await heapUsed(page);
      return {
        baselineMB: mb(base),
        realisticMix1500: { usedMB: mb(fromDevice), deltaMB: mb(fromDevice - base) },
        releasedMB: mb(released),
        worstCase1500x8000chars: { usedMB: mb(worst), deltaMB: mb(worst - released) },
      };
    });
    save(outDir, engine, res);
  }
  return res;
}

export async function runBrowserBench(o: {
  outDir: string;
  webkit: boolean;
  webkitOnly?: boolean;
}) {
  const files = await buildPage();
  if (o.webkitOnly) return { webkit: await benchEngine("webkit", o.outDir, files) };
  const chromiumRes = await benchEngine("chromium", o.outDir, files);
  const out: Record<string, unknown> = { chromium: chromiumRes };
  if (o.webkit) {
    try {
      out.webkit = await benchEngine("webkit", o.outDir, files);
    } catch (e) {
      out.webkit = { error: String(e).split("\n")[0] };
    }
  }
  const relaunch = chromiumRes.coldRelaunch as Record<string, { totalMs: { p95: number } }>;
  const write = chromiumRes.write as Record<string, { syncMs: { p95: number } }>;
  const heap = chromiumRes.heap as {
    realisticMix1500: { deltaMB: number };
    worstCase1500x8000chars: { deltaMB: number };
  };
  const bars = {
    bar1ColdOpenP95Ms: relaunch["compound · advance+getAll · 10,000"].totalMs.p95,
    bar2MainThreadP95Ms: write["compound · 500 new rows"].syncMs.p95,
    bar4HeapDeltaMB: heap.realisticMix1500.deltaMB,
    bar4WorstCaseDeltaMB: heap.worstCase1500x8000chars.deltaMB,
  };
  out.bars = bars;
  out.pass =
    bars.bar1ColdOpenP95Ms <= 100 && bars.bar2MainThreadP95Ms <= 8 && bars.bar4HeapDeltaMB <= 50;
  return out;
}

declare global {
  interface Window {
    spike: import("./page/main").SpikeApi;
  }
}
