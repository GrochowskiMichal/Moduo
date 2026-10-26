#!/usr/bin/env node
// The product lab: drives a running app through declared screens, states and journeys and
// writes an evidence dossier for the blind critic (/product-jury) and the builder.
//
//   node lab.mjs [--config lab.config.mjs] [--label name] [--engine webkit|chromium]
//                [--only states,windows,themes,focus,hover,overlays,journeys,tokens,a11y]
//                [--screens a,b] [--journeys a,b] [--ablate level1|no-focus,...]
//                [--headed] [--base-url url] [--impeccable] [--init]
//
// Run it from the project root (Playwright and axe-core resolve from there). It prints the
// dossier's absolute path as its last line. references/config.md describes the config,
// references/dossier.md what it writes, references/budgets.md how gates are computed.
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DESCRIPTIONS, applyRoutes, expand, initScript } from "./lib/ablate.mjs";
import { PROBE, finishAll, focusInfo, hoverTargets, inventory, overlayBox, pageInfo, seekOverlay, settle, stylesAt } from "./lib/probe.mjs";
import { launch, loadAxe, runAxe } from "./lib/pw.mjs";
import { criticMd, dossierMd, feelRows, gates, measurementsMd } from "./lib/report.mjs";
import { contactSheet, crop } from "./lib/sheet.mjs";
import { harvest, resolveTokens, score, shadowLayers, toRgba, tokenNames } from "./lib/tokens.mjs";
import { list, log, median, mkdirp, pad, parseArgs, percentile, rel, round, runId, sleep, slug, writeJson, writeText } from "./lib/util.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2), ["config", "label", "engine", "only", "screens", "journeys", "ablate", "base-url", "out"]);
const ROOT = process.cwd();

if (args.init) {
  const target = path.join(ROOT, "lab.config.mjs");
  if (fs.existsSync(target)) throw new Error("lab.config.mjs already exists");
  fs.copyFileSync(path.join(HERE, "..", "templates", "lab.config.mjs"), target);
  log(`Wrote ${target}. Fill in seeds, screens and journeys, then run the lab.`);
  process.exit(0);
}

const configPath = [args.config, "lab.config.mjs", "lab.config.ts", "e2e/lab/lab.config.ts", "e2e/lab/lab.config.mjs", ".lab/lab.config.mjs"]
  .filter(Boolean)
  .map((p) => path.resolve(ROOT, p))
  .find((p) => fs.existsSync(p));
if (!configPath) {
  log("No lab config found. Run with --init for a starter, or pass --config <path>.");
  process.exit(2);
}
const cfg = (await import(pathToFileURL(configPath).href)).default;
const only = new Set(list(args.only) ?? ["states", "windows", "themes", "focus", "hover", "overlays", "journeys", "tokens", "a11y"]);
const engine = args.engine ?? (String(cfg.platform ?? "").startsWith("macos") ? "webkit" : "chromium");
const headed = Boolean(args.headed);
const ablations = expand(args.ablate);
const baseURL = args["base-url"] ?? cfg.baseURL;
const viewport = cfg.viewport ?? { width: 1440, height: 900 };
const primaryTheme = cfg.primaryTheme ?? "light";
const screenFilter = list(args.screens);
const journeyFilter = list(args.journeys);
const screens = (cfg.screens ?? []).filter((s) => !screenFilter || screenFilter.includes(s.id));
const journeys = (cfg.journeys ?? []).filter((j) => !journeyFilter || journeyFilter.includes(j.id));
const OUT = path.resolve(ROOT, args.out ?? ".lab", runId(args.label ?? (ablations.length ? `ablate-${args.ablate}` : "run")));
mkdirp(OUT);
log(`lab → ${OUT}`);

// ── server ───────────────────────────────────────────────────────────────────────────────
async function reachable(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.status < 500;
  } catch {
    return false;
  }
}
let server = null;
if (!(await reachable(baseURL))) {
  if (!cfg.server?.command) throw new Error(`${baseURL} does not answer and the config has no server.command`);
  log(`starting: ${cfg.server.command}`);
  server = spawn(cfg.server.command, { cwd: path.resolve(ROOT, cfg.server.cwd ?? "."), shell: true, detached: true, stdio: "ignore" });
  const until = Date.now() + (cfg.server.timeout ?? 120000);
  while (!(await reachable(baseURL))) {
    if (Date.now() > until) throw new Error(`server did not answer at ${baseURL}`);
    await sleep(1000);
  }
}
const stopServer = () => {
  if (server) {
    try {
      process.kill(-server.pid);
    } catch {}
  }
};
process.on("exit", stopServer);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));

// ── browser and contexts ─────────────────────────────────────────────────────────────────
const cdpPort = args.impeccable && engine === "chromium" ? 9333 : null;
const browser = await launch(engine, { headed, cdpPort });
const axeSource = only.has("a11y") ? await loadAxe() : null;
const seed = cfg.setup ? await cfg.setup({ log }) : {};
const errors = { console: new Set(), page: new Set(), failedRequests: [] };
// Environment noise the config declares (a local service that isn't running), never app bugs.
const ignoredConsole = (cfg.ignore?.console ?? []).map((s) => new RegExp(s, "i"));
const ignoredRequests = (cfg.ignore?.requests ?? []).map((s) => new RegExp(s, "i"));

// Safari's engine tabs only to text fields unless the person turns on keyboard navigation,
// so the focus walk always runs in Chromium, where Tab reaches every control.
let chromiumForFocus = null;
async function focusBrowser() {
  if (engine === "chromium") return browser;
  chromiumForFocus ??= await launch("chromium", { headed });
  return chromiumForFocus;
}

async function newPage({ variant = "default", size = viewport, theme = primaryTheme, reducedMotion = "no-preference", record = true, using = browser } = {}) {
  const context = await using.newContext({
    viewport: size,
    deviceScaleFactor: 1,
    colorScheme: theme === "dark" ? "dark" : "light",
    reducedMotion,
    locale: "en-US",
  });
  await context.addInitScript(PROBE);
  if (ablations.length) {
    await context.addInitScript(initScript(ablations));
    await applyRoutes(context, ablations);
  }
  const page = await context.newPage();
  page.__faulted = false;
  if (record) {
    page.on("console", (m) => {
      const text = m.text();
      if (m.type() === "error" && !page.__faulted && !ignoredConsole.some((re) => re.test(text))) errors.console.add(text.slice(0, 200));
    });
    page.on("pageerror", (e) => {
      if (!page.__faulted) errors.page.add(String(e.message).slice(0, 200));
    });
    page.on("response", (r) => {
      if (r.status() >= 500 && !page.__faulted && errors.failedRequests.length < 50 && !ignoredRequests.some((re) => re.test(r.url()))) errors.failedRequests.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 140)}`);
    });
    page.on("requestfailed", (r) => {
      if (!page.__faulted && errors.failedRequests.length < 50 && !ignoredRequests.some((re) => re.test(r.url()))) errors.failedRequests.push(`${r.method()} ${r.url().slice(0, 140)} ${r.failure()?.errorText ?? ""}`);
    });
  }
  if (cfg.auth) await cfg.auth({ context, page, seed, variant });
  if (theme !== primaryTheme && cfg.theme) await cfg.theme({ context, page }, theme);
  return { context, page };
}

async function waitReady(page, ready, timeout = 30000) {
  if (typeof ready === "function") return ready({ page });
  if (typeof ready === "string") return page.locator(ready).first().waitFor({ state: "visible", timeout });
  return page.waitForLoadState("networkidle", { timeout });
}

async function openScreen(page, screen, { early = false } = {}) {
  const t0 = Date.now();
  await page.goto(new URL(screen.path ?? "/", baseURL).href, { waitUntil: "domcontentloaded" });
  if (early) {
    // What a person sees a moment after opening, while the (delayed) data is still on its way.
    await page.waitForTimeout(1500);
    return null;
  }
  await waitReady(page, screen.ready);
  await page.evaluate(settle, 1500);
  return Date.now() - t0;
}

const data = {
  meta: { engine, headed, ablations, viewport, config: rel(ROOT, configPath), baseURL, startedAt: new Date().toISOString(), eventTiming: null, layoutShift: null, loaf: null },
  states: [],
  windows: [],
  themes: [],
  focus: {},
  hover: {},
  overlays: [],
  journeys: [],
  tokens: null,
  impeccable: null,
  errors,
};
const tokenRows = [];
let tokenTable = null;

async function probeSupport(page) {
  const s = await page.evaluate(() => ({ eventTiming: window.__lab?.eventTiming, layoutShift: window.__lab?.layoutShift, loaf: window.__lab?.loaf }));
  Object.assign(data.meta, s);
}

// ── states, windows, themes ──────────────────────────────────────────────────────────────
const defaultInfo = {};
if (["states", "windows", "themes", "tokens", "a11y"].some((x) => only.has(x))) {
  for (const screen of screens) {
    const states = Object.entries(screen.states ?? { default: {} });
    if (!states.some(([k]) => k === "default")) states.unshift(["default", {}]);
    for (const [name, st] of states) {
      if (!only.has("states") && name !== "default") continue;
      log(`state ${screen.id}/${name}`);
      const rec = { screen: screen.id, title: screen.title, state: name, file: null, info: null, axe: null, error: null };
      const { context, page } = await newPage({ variant: st.seed ?? "default" });
      try {
        if (st.delay || st.fail) page.__faulted = true;
        if (st.delay) await page.route(st.delay.match, async (r) => { await sleep(st.delay.ms ?? 4000); await r.fallback(); });
        if (st.fail) await page.route(st.fail.match, (r) => r.fulfill({ status: st.fail.status ?? 500, contentType: "application/json", body: JSON.stringify({ message: "lab: injected failure" }) }));
        try {
          rec.readyMs = await openScreen(page, { ...screen, path: st.path ?? screen.path }, { early: st.capture === "early" });
        } catch (e) {
          rec.error = `not ready: ${String(e.message).split("\n")[0].slice(0, 120)}`;
        }
        if (st.offline) {
          page.__faulted = true;
          await context.setOffline(true);
          if (st.act) await st.act({ page });
          await page.waitForTimeout(st.wait ?? 2500);
        } else if (st.act) {
          await st.act({ page });
          await page.evaluate(settle, 1500);
        }
        if (!data.meta.eventTiming) await probeSupport(page).catch(() => {});
        rec.file = path.join(OUT, "states", screen.id, `${slug(name)}.png`);
        mkdirp(path.dirname(rec.file));
        await page.screenshot({ path: rec.file });
        const info = await page.evaluate(pageInfo);
        info.blank = info.textLength < 10 || info.visibleElements < 5;
        info.crashed = info.blank && info.errors.length > 0;
        if (name === "default") defaultInfo[screen.id] = info;
        else if (defaultInfo[screen.id]) info.sameAsDefault = info.textHash === defaultInfo[screen.id].textHash;
        rec.info = info;
        if (only.has("a11y") && !rec.error) rec.axe = await runAxe(page, axeSource).catch((e) => ({ skipped: `axe failed: ${e.message}` }));
        if (only.has("tokens") && !st.capture) {
          if (!tokenTable) tokenTable = await page.evaluate(resolveTokens, tokenNames(cfg.tokens?.files, ROOT));
          const rows = await page.evaluate(harvest, { exclude: cfg.tokens?.exclude ?? [], max: 6000 });
          for (const r of rows) tokenRows.push({ ...r, state: `${screen.id}/${name}`, file: rec.file });
        }
        if (name === "default" && only.has("windows")) {
          for (const [w, h] of cfg.windows ?? []) {
            await page.setViewportSize({ width: w, height: h });
            await page.waitForTimeout(250);
            await page.evaluate(settle, 800);
            const file = path.join(OUT, "windows", `${screen.id}-${w}x${h}.png`);
            mkdirp(path.dirname(file));
            await page.screenshot({ path: file });
            const wi = await page.evaluate(pageInfo);
            data.windows.push({ screen: screen.id, w, h, file, overflowX: wi.overflowX, scrollWidth: wi.scrollWidth, offenders: wi.offenders });
          }
          await page.setViewportSize(viewport);
        }
      } catch (e) {
        rec.error = rec.error ?? String(e.message).split("\n")[0].slice(0, 160);
      } finally {
        await context.close();
      }
      data.states.push(rec);
    }
    if (only.has("themes")) {
      const variants = [...(cfg.themes ?? [primaryTheme]).filter((t) => t !== primaryTheme).map((t) => ({ theme: t, reduced: false })), { theme: primaryTheme, reduced: true }];
      for (const v of variants) {
        const { context, page } = await newPage({ theme: v.theme, reducedMotion: v.reduced ? "reduce" : "no-preference" });
        try {
          await openScreen(page, screen);
          const file = path.join(OUT, "themes", `${screen.id}-${v.theme}${v.reduced ? "-reduced-motion" : ""}.png`);
          mkdirp(path.dirname(file));
          await page.screenshot({ path: file });
          data.themes.push({ screen: screen.id, theme: v.theme, reducedMotion: v.reduced, file });
        } catch (e) {
          data.themes.push({ screen: screen.id, theme: v.theme, reducedMotion: v.reduced, error: String(e.message).split("\n")[0] });
        } finally {
          await context.close();
        }
      }
    }
  }
}

// ── focus walk and pointer feedback ──────────────────────────────────────────────────────
for (const screen of screens) {
  if (only.has("focus")) {
    log(`focus ${screen.id}`);
    const { context, page } = await newPage({ using: await focusBrowser() });
    const stops = [];
    try {
      await openScreen(page, screen);
      const max = cfg.focus?.stops ?? 25;
      let repeats = 0;
      let last = null;
      for (let n = 1; n <= max; n++) {
        await page.keyboard.press("Tab");
        await page.waitForTimeout(120);
        const info = await page.evaluate(focusInfo);
        info.n = n;
        const key = `${info.tag}|${info.name}|${Math.round(info.rect?.x ?? 0)}|${Math.round(info.rect?.y ?? 0)}`;
        repeats = key === last ? repeats + 1 : 0;
        last = key;
        if (!info.none && info.inViewport) {
          // Enough of the surroundings to see where focus is, not just the control.
          const r = info.rect;
          const w = Math.max(360, r.width + 160);
          const h = Math.max(160, r.height + 96);
          const x = Math.max(0, Math.min(viewport.width - w, r.x + r.width / 2 - w / 2));
          const y = Math.max(0, Math.min(viewport.height - h, r.y + r.height / 2 - h / 2));
          const file = path.join(OUT, "focus", screen.id, `k-${pad(n)}.png`);
          mkdirp(path.dirname(file));
          await page.screenshot({ path: file, clip: { x, y, width: Math.min(w, viewport.width), height: Math.min(h, viewport.height) } });
          info.file = file;
        }
        stops.push(info);
        if (repeats >= 2) {
          stops.at(-1).trapped = true;
          break;
        }
      }
    } catch (e) {
      stops.push({ error: String(e.message).split("\n")[0] });
    } finally {
      await context.close();
    }
    data.focus[screen.id] = { stops: stops.filter((s) => !s.error), error: stops.find((s) => s.error)?.error };
  }
  if (only.has("hover")) {
    log(`hover ${screen.id}`);
    const { context, page } = await newPage();
    const pairs = [];
    try {
      await openScreen(page, screen);
      const targets = await page.evaluate(hoverTargets, { selector: cfg.hover?.selector ?? "button, a[href], [role='tab'], [role='menuitem'], [role='option']", max: cfg.hover?.max ?? 12 });
      let n = 0;
      for (const t of targets) {
        n++;
        const c = { x: t.x + t.width / 2, y: t.y + t.height / 2 };
        const clip = { x: Math.max(0, t.x - 12), y: Math.max(0, t.y - 10), width: Math.min(viewport.width - Math.max(0, t.x - 12), t.width + 24), height: Math.min(viewport.height - Math.max(0, t.y - 10), t.height + 20) };
        await page.mouse.move(2, viewport.height - 2);
        await page.waitForTimeout(180);
        const rest = await page.evaluate(stylesAt, c);
        const restFile = path.join(OUT, "hover", screen.id, `h-${pad(n)}-rest.png`);
        mkdirp(path.dirname(restFile));
        await page.screenshot({ path: restFile, clip });
        await page.mouse.move(c.x, c.y, { steps: 3 });
        await page.waitForTimeout(260);
        const hover = await page.evaluate(stylesAt, c);
        const hoverFile = path.join(OUT, "hover", screen.id, `h-${pad(n)}-hover.png`);
        await page.screenshot({ path: hoverFile, clip });
        const changed = [...new Set(Object.keys(hover).filter((k) => hover[k] !== rest[k]).map((k) => k.split(":")[1]))];
        pairs.push({ n, name: t.name, tag: t.tag, role: t.role, rest: restFile, hover: hoverFile, changed });
      }
    } catch (e) {
      pairs.push({ n: 0, name: "error", changed: ["error"], error: String(e.message).split("\n")[0] });
    } finally {
      await context.close();
    }
    data.hover[screen.id] = pairs.filter((p) => !p.error);
  }
}

// ── overlays ─────────────────────────────────────────────────────────────────────────────
function easingClass(e) {
  if (!e) return "unknown";
  if (/ease-out|^cubic-bezier\(0(\.0+)?,/.test(e)) return "decelerating";
  const m = e.match(/cubic-bezier\(([^)]+)\)/);
  if (m) {
    const [x1, y1, x2, y2] = m[1].split(",").map(Number);
    const start = x1 === 0 ? Infinity : y1 / x1;
    const end = x2 === 1 ? Infinity : (1 - y2) / (1 - x2);
    if (start > 1 && end < 1) return "decelerating";
    if (start < 1 && end > 1) return "accelerating";
    return "standard";
  }
  if (/^linear\(/.test(e)) return "standard";
  if (e === "ease" || e === "ease-in-out") return "standard";
  if (e === "ease-in") return "accelerating";
  return "linear";
}

const longest = (inv) => inv.filter((a) => a.duration != null && a.iterations !== Infinity).sort((a, b) => b.delay + b.duration - (a.delay + a.duration))[0];

async function trigger(page, fn) {
  if (typeof fn === "string") await page.keyboard.press(fn);
  else await fn({ page });
}

async function waitShown(page, sel, shown, timeout = 3000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const box = await page.evaluate(overlayBox, sel);
    if (shown ? box : !box) return box ?? true;
    await page.waitForTimeout(16);
  }
  return null;
}

if (only.has("overlays")) {
  for (const ov of cfg.overlays ?? []) {
    const screen = screens.find((s) => s.id === ov.screen);
    if (!screen) continue;
    log(`overlay ${ov.id}`);
    const rec = { id: ov.id, screen: ov.screen, kind: ov.kind ?? "dialog" };
    const { context, page } = await newPage();
    try {
      await openScreen(page, screen);
      // entry
      await page.evaluate(() => window.__lab.startFrames());
      await page.evaluate((sel) => window.__lab.watch(sel), ov.selector);
      await trigger(page, ov.open);
      const shown = await waitShown(page, ov.selector, true);
      if (!shown) throw new Error("overlay did not appear");
      const stamp = await page.evaluate(() => ({ start: window.__lab.watchStart, shown: window.__lab.shownAt }));
      rec.openMs = stamp.shown ? round(stamp.shown - stamp.start, 0) : null;
      const entryInv = await page.evaluate(inventory, ov.selector);
      const docInv = await page.evaluate(inventory, null);
      const main = longest(entryInv) ?? longest(docInv.filter((a) => a.state === "running"));
      const entryMs = main ? main.delay + main.duration : 0;
      rec.entry = { duration: round(entryMs, 0), easing: main?.easing ?? null, easingClass: easingClass(main?.easing), props: main?.props ?? [], moves: Boolean(main?.moves), layout: entryInv.some((a) => a.layout) };
      await page.waitForTimeout(entryMs + 150);
      const frames = await page.evaluate(() => window.__lab.stopFrames());
      const gaps = frames.slice(1).map((t, i) => t - frames[i]);
      if (gaps.length > 3) {
        const refresh = percentile(gaps, 10);
        let run = 0;
        let consecutive = 0;
        let dropped = 0;
        for (const g of gaps) {
          if (g > refresh * 1.5) {
            dropped++;
            run++;
            consecutive = Math.max(consecutive, run);
          } else run = 0;
        }
        rec.frames = { refresh: round(refresh, 1), dropped, consecutive, longest: round(Math.max(...gaps), 1), n: gaps.length };
      }
      // The open overlay's box, widened for context: the strip frames are cropped to it.
      const box = await page.evaluate(overlayBox, ov.selector);
      if (box) {
        const w = Math.min(viewport.width, Math.max(560, box.width + 240));
        const h = Math.min(viewport.height, Math.max(360, box.height + 200));
        const x = Math.max(0, Math.min(viewport.width - w, box.x + box.width / 2 - w / 2));
        const y = Math.max(0, Math.min(viewport.height - h, box.y + box.height / 2 - h / 2));
        rec.clip = { x, y, width: w, height: h };
      }
      // exit
      await trigger(page, ov.close ?? "Escape");
      const exitInv = await page.evaluate(inventory, ov.selector);
      const exitMain = longest(exitInv);
      rec.exit = { duration: exitMain ? round(exitMain.delay + exitMain.duration, 0) : 0, easing: exitMain?.easing ?? null };
      rec.ratio = entryMs > 0 ? round(rec.exit.duration / entryMs, 2) : null;
      await waitShown(page, ov.selector, false);
      await page.waitForTimeout(300);
      // filmstrip: pause the entry at fixed fractions
      if (entryMs > 0) {
        await trigger(page, ov.open);
        await waitShown(page, ov.selector, true);
        const frames5 = [];
        for (const f of [0, 0.25, 0.5, 0.75, 1]) {
          await page.evaluate(seekOverlay, { selector: ov.selector, fraction: f });
          const file = path.join(OUT, "overlays", ov.id, `f-${Math.round(f * 100)}.png`);
          mkdirp(path.dirname(file));
          await page.screenshot({ path: file, ...(rec.clip ? { clip: rec.clip } : {}) });
          frames5.push({ file, caption: `${Math.round(f * 100)}% of ${round(entryMs, 0)} ms` });
        }
        await page.evaluate(finishAll);
        rec.stripFrames = frames5;
        await trigger(page, ov.close ?? "Escape");
        await waitShown(page, ov.selector, false);
        await page.waitForTimeout(300);
      }
      // interrupt: close at 40% of the entry, reopen at once
      await trigger(page, ov.open);
      await page.waitForTimeout(Math.max(30, entryMs * 0.4));
      await trigger(page, ov.close ?? "Escape");
      const tRe = Date.now();
      await trigger(page, ov.open);
      let settled = null;
      while (Date.now() - tRe < 1500) {
        const box = await page.evaluate(overlayBox, ov.selector);
        const busy = await page.evaluate((sel) => {
          const el = [...document.querySelectorAll(sel)].pop();
          return el ? el.getAnimations({ subtree: true }).some((a) => a.playState === "running") : true;
        }, ov.selector);
        if (box && box.opacity > 0.97 && !busy) {
          settled = Date.now() - tRe;
          break;
        }
        await page.waitForTimeout(16);
      }
      rec.interrupt = { ok: settled != null, settleMs: settled };
      await trigger(page, ov.close ?? "Escape");
    } catch (e) {
      rec.error = String(e.message).split("\n")[0].slice(0, 160);
    } finally {
      await context.close();
    }
    if (!rec.error) {
      const r = await newPage({ reducedMotion: "reduce" });
      try {
        await openScreen(r.page, screen);
        await trigger(r.page, ov.open);
        await waitShown(r.page, ov.selector, true);
        const inv = await r.page.evaluate(inventory, ov.selector);
        rec.reduced = { moves: inv.some((a) => a.moves && (a.duration ?? 0) > 0), animations: inv.length };
      } catch {
      } finally {
        await r.context.close();
      }
    }
    data.overlays.push(rec);
  }
}

// ── journeys ─────────────────────────────────────────────────────────────────────────────
class Stop extends Error {}

if (only.has("journeys")) {
  for (const j of journeys) {
    for (const mode of ["keyboard", "pointer"]) {
      if (typeof j[mode] !== "function") continue;
      log(`journey ${j.id} (${mode})`);
      const screen = screens.find((s) => s.id === j.screen) ?? (cfg.screens ?? []).find((s) => s.id === j.screen) ?? { path: j.path ?? "/" };
      const rec = { id: j.id, goal: j.goal, screen: j.screen, mode, target: j.target ?? null, counts: { keys: 0, clicks: 0, travel: 0 }, completed: false, error: null, hardFail: null, steps: [] };
      const { context, page } = await newPage({ variant: j.seed ?? "default" });
      const dir = path.join(OUT, "journeys", slug(j.id), mode);
      mkdirp(dir);
      let pointer = { x: viewport.width / 2, y: viewport.height / 2 };
      let pending = { key: 0, pointer: 0, keyMotion: [] };
      const pull = () =>
        page.evaluate(() => {
          const L = window.__lab;
          return { events: L.events.splice(0), shifts: L.shifts.splice(0), loafs: L.loafs.splice(0), errors: L.errors.splice(0) };
        });
      const keyMotion = async () => {
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
        const inv = await page.evaluate(inventory, null);
        const running = inv.filter((a) => a.state === "running" && a.iterations !== Infinity && (a.moves || a.props.includes("opacity")));
        pending.keyMotion.push(running.length ? Math.max(...running.map((a) => (a.delay ?? 0) + (a.duration ?? 0))) : 0);
      };
      const helpers = {
        page,
        press: async (keys) => {
          rec.counts.keys += String(keys).split("+").length;
          pending.key++;
          await page.keyboard.press(keys);
          await keyMotion();
        },
        type: async (text) => {
          rec.counts.keys += text.length;
          pending.key += text.length;
          await page.keyboard.type(text, { delay: 20 });
        },
        click: async (target, opts) => {
          const loc = typeof target === "string" ? page.locator(target).first() : target;
          const box = await loc.boundingBox({ timeout: 5000 }).catch(() => null);
          if (box) {
            const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
            rec.counts.travel += Math.hypot(c.x - pointer.x, c.y - pointer.y);
            pointer = c;
          }
          rec.counts.clicks++;
          pending.pointer++;
          await loc.click({ timeout: 5000, ...opts });
        },
        step: async (label, opts = {}) => {
          const n = rec.steps.length + 1;
          let waitMs = null;
          if (opts.expect || opts.gone) {
            const t = Date.now();
            const timeout = opts.timeout ?? 5000;
            try {
              if (typeof opts.expect === "function") {
                // A predicate, polled: for proofs no single element shows (a count went up).
                while (!(await opts.expect())) {
                  if (Date.now() - t > timeout) throw new Error("timeout");
                  await page.waitForTimeout(50);
                }
              } else if (opts.expect) {
                const loc = typeof opts.expect === "string" ? page.locator(opts.expect).first() : opts.expect;
                await loc.waitFor({ state: "visible", timeout });
              }
              if (opts.gone) {
                const loc = typeof opts.gone === "string" ? page.locator(opts.gone).first() : opts.gone;
                await loc.waitFor({ state: "hidden", timeout });
              }
              waitMs = Date.now() - t;
            } catch {
              rec.hardFail = { kind: "no-response", where: `step ${pad(n)} ${label}` };
              const file = path.join(dir, `${pad(n)}-${slug(label)}-missing.png`);
              await page.screenshot({ path: file }).catch(() => {});
              rec.steps.push({ n, label, file, missing: true, interactions: [], keyMotion: [] });
              throw new Stop(`"${label}" never appeared`);
            }
          }
          await page.waitForTimeout(120);
          await page.evaluate(settle, 900);
          const file = path.join(dir, `${pad(n)}-${slug(label)}.png`);
          await page.screenshot({ path: file });
          const got = await pull();
          const byId = new Map();
          for (const e of got.events.filter((e) => e.id > 0)) {
            const kind = e.name.startsWith("key") ? "key" : "pointer";
            const prev = byId.get(e.id);
            if (!prev || e.duration > prev.duration) byId.set(e.id, { kind, duration: e.duration, name: e.name, target: e.target });
          }
          const interactions = [...byId.values()];
          for (const kind of ["key", "pointer"]) {
            const missing = pending[kind] - interactions.filter((i) => i.kind === kind).length;
            for (let i = 0; i < missing; i++) interactions.push({ kind, duration: 16, unreported: true });
          }
          for (const e of got.errors) errors.page.add(e.slice(0, 200));
          rec.steps.push({ n, label, file, waitMs, view: Boolean(opts.view), interactions, keyMotion: pending.keyMotion, shift: round(got.shifts.reduce((s, x) => s + x.value, 0), 4), loaf: got.loafs.map((l) => round(l.duration, 0)) });
          pending = { key: 0, pointer: 0, keyMotion: [] };
        },
      };
      try {
        await openScreen(page, screen);
        if (data.meta.eventTiming == null) await probeSupport(page).catch(() => {});
        await pull();
        await j[mode](helpers);
        rec.completed = true;
      } catch (e) {
        rec.error = String(e.message).split("\n")[0].slice(0, 160);
        if (!(e instanceof Stop)) {
          const file = path.join(dir, "error.png");
          await page.screenshot({ path: file }).catch(() => {});
          rec.errorFile = file;
        }
      } finally {
        await context.close();
      }
      data.journeys.push(rec);
    }
  }
}

// ── tokens ───────────────────────────────────────────────────────────────────────────────
const util = await browser.newContext();
const utilPage = await util.newPage();
await utilPage.setContent("<!doctype html><title>lab</title>");
if (only.has("tokens") && tokenTable) {
  const colors = new Set([...tokenRows.filter((r) => r.fam === "color").map((r) => r.value), ...tokenTable.filter((t) => t.kind === "color").map((t) => t.value), ...tokenRows.filter((r) => r.fam === "shadow").flatMap((r) => shadowLayers(r.value).map((l) => l.color).filter(Boolean))]);
  const rgba = await utilPage.evaluate(toRgba, [...colors]);
  data.tokens = score(tokenRows, tokenTable, rgba);
  let i = 0;
  for (const t of data.tokens.top) {
    i++;
    const w = t.where[0];
    const row = tokenRows.find((r) => r.state === w?.state);
    if (!w || !row) continue;
    t.crop = await crop(browser, row.file, { x: w.x, y: w.y, w: w.w, h: w.h }, path.join(mkdirp(path.join(OUT, "tokens")), `drift-${pad(i)}.png`), { pad: 32 }).catch(() => null);
  }
  writeJson(path.join(OUT, "tokens.json"), { ...data.tokens, tokens: tokenTable });
}
await util.close();

// ── optional: Impeccable's detector on the rendered states (builder only) ────────────────
if (args.impeccable) {
  if (engine !== "chromium") data.impeccable = { skipped: "needs --engine chromium (it attaches over CDP)" };
  else {
    const results = [];
    for (const screen of screens) {
      const { context, page } = await newPage();
      try {
        await openScreen(page, screen);
        const out = await new Promise((resolve) =>
          execFile("npx", ["-y", "impeccable@4.7.0", "detect", "--cdp", String(cdpPort), "--target", page.url(), "--json"], { cwd: ROOT, timeout: 180000, env: { ...process.env, IMPECCABLE_TELEMETRY: "0", DO_NOT_TRACK: "1" } }, (err, stdout, stderr) => resolve({ code: err?.code ?? 0, stdout, stderr })),
        );
        let parsed = null;
        try {
          parsed = JSON.parse(out.stdout);
        } catch {}
        results.push({ screen: screen.id, code: out.code, findings: parsed, error: parsed ? null : String(out.stderr || out.stdout).slice(0, 400) });
      } finally {
        await context.close();
      }
    }
    const count = results.reduce((n, r) => n + (Array.isArray(r.findings) ? r.findings.length : Array.isArray(r.findings?.findings) ? r.findings.findings.length : 0), 0);
    data.impeccable = { summary: `${count} findings over ${results.length} screens`, results };
    writeJson(path.join(OUT, "impeccable.json"), data.impeccable);
  }
}

// ── sheets ───────────────────────────────────────────────────────────────────────────────
log("contact sheets");
const visual = [];
const sheet = async (items, out, title, opts) => {
  const f = await contactSheet(browser, items, out, { title, ...opts });
  return f;
};
for (const screen of screens) {
  const items = data.states.filter((s) => s.screen === screen.id && s.file).map((s) => ({ file: s.file, caption: `${s.state}${s.error ? ` (${s.error})` : ""}` }));
  const f = await sheet(items, path.join(OUT, "states", screen.id, "sheet.png"), `${screen.title ?? screen.id}: states`);
  if (f) visual.push({ title: `${screen.title ?? screen.id}, every state`, files: [f] });
}
for (const screen of screens) {
  const items = data.windows.filter((w) => w.screen === screen.id).map((w) => ({ file: w.file, caption: `${w.w}x${w.h}${w.overflowX ? " (overflows)" : ""}` }));
  const f = await sheet(items, path.join(OUT, "windows", `${screen.id}-sheet.png`), `${screen.title ?? screen.id}: window sizes`, { columns: 2 });
  if (f) visual.push({ title: `${screen.title ?? screen.id}, window sizes`, files: [f] });
}
{
  const items = data.themes.filter((t) => t.file).map((t) => ({ file: t.file, caption: `${t.screen}: ${t.theme}${t.reducedMotion ? ", reduced motion" : ""}` }));
  const f = await sheet(items, path.join(OUT, "themes", "sheet.png"), "Other themes and reduced motion");
  if (f) visual.push({ title: "Secondary theme and reduced motion", files: [f] });
}
for (const j of data.journeys) {
  const items = j.steps.map((s) => ({ file: s.file, caption: `${pad(s.n)} ${s.label}${s.missing ? " (expected result never appeared)" : ""}` }));
  if (j.errorFile) items.push({ file: j.errorFile, caption: `stopped: ${j.error}` });
  const f = await sheet(items, path.join(OUT, "journeys", slug(j.id), j.mode, "sheet.png"), `${j.id} (${j.mode}): ${j.goal}`);
  if (f) visual.push({ title: `Journey "${j.id}" ${j.mode}-only, step by step`, files: [f] });
}
for (const [screen, f] of Object.entries(data.focus)) {
  const items = f.stops.filter((s) => s.file).map((s) => ({ file: s.file, caption: `k-${pad(s.n)} ${s.tag} "${s.name}"` }));
  const out = await sheet(items, path.join(OUT, "focus", screen, "sheet.png"), `${screen}: keyboard focus, Tab by Tab`, { columns: 4 });
  if (out) visual.push({ title: `${screen}, keyboard focus stops`, files: [out] });
}
for (const [screen, pairs] of Object.entries(data.hover)) {
  const items = pairs.flatMap((p) => [
    { file: p.rest, caption: `h-${pad(p.n)} at rest: ${p.name}` },
    { file: p.hover, caption: `h-${pad(p.n)} under the pointer` },
  ]);
  const out = await sheet(items, path.join(OUT, "hover", screen, "sheet.png"), `${screen}: pointer targets, at rest and under the pointer`, { columns: 4 });
  if (out) visual.push({ title: `${screen}, rest and hover pairs`, files: [out] });
}
for (const o of data.overlays.filter((o) => o.stripFrames)) {
  const out = await sheet(o.stripFrames, path.join(OUT, "overlays", o.id, "strip.png"), `${o.id}: entry, paused at fixed fractions`, { columns: 5 });
  if (out) {
    o.strip = out;
    visual.push({ title: `${o.id} opening, frame by frame`, files: [out] });
  }
}
if (data.tokens?.top?.some((t) => t.crop)) visual.push({ title: "Crops of the most common off-token values (see the table in measurements.md)", files: data.tokens.top.filter((t) => t.crop).map((t) => t.crop) });

// ── write ────────────────────────────────────────────────────────────────────────────────
const feel = feelRows(data);
const g = gates(data, feel);
const platformBrief = `${rel(OUT, path.join(HERE, "..", "references", "platform-brief.md"))}, section "${cfg.platform ?? "web"}"`;
writeJson(path.join(OUT, "feel.json"), feel);
writeJson(path.join(OUT, "gates.json"), g);
writeJson(path.join(OUT, "a11y.json"), data.states.map((s) => ({ screen: s.screen, state: s.state, axe: s.axe })));
writeJson(path.join(OUT, "states", "index.json"), data.states.map((s) => ({ ...s, file: s.file && rel(OUT, s.file), axe: undefined })));
writeJson(path.join(OUT, "journeys", "index.json"), data.journeys.map((j) => ({ ...j, steps: j.steps.map((s) => ({ ...s, file: rel(OUT, s.file) })) })));
writeJson(path.join(OUT, "focus", "index.json"), data.focus);
writeJson(path.join(OUT, "hover", "index.json"), data.hover);
writeJson(path.join(OUT, "overlays", "index.json"), data.overlays);
if (ablations.length) writeJson(path.join(OUT, "ablation.json"), { ablations: ablations.map((a) => ({ id: a, what: DESCRIPTIONS[a] })) });
writeText(path.join(OUT, "measurements.md"), measurementsMd(data, feel, OUT));
writeText(path.join(OUT, "critic.md"), criticMd(data, cfg, OUT, { visual, platformBrief: path.join(HERE, "..", "references", "platform-brief.md") + ` (${cfg.platform ?? "web"})` }));
writeText(path.join(OUT, "dossier.md"), dossierMd(data, g, feel, OUT));
writeJson(path.join(OUT, "summary.json"), {
  ...data.meta,
  finishedAt: new Date().toISOString(),
  counts: { states: data.states.length, windows: data.windows.length, journeys: data.journeys.length, overlays: data.overlays.length, focusScreens: Object.keys(data.focus).length },
  journeys: data.journeys.map((j) => ({ id: j.id, mode: j.mode, completed: j.completed, error: j.error })),
  stateErrors: data.states.filter((s) => s.error).map((s) => `${s.screen}/${s.state}: ${s.error}`),
  errors: { console: [...errors.console], page: [...errors.page], failedRequests: errors.failedRequests },
  gates: Object.fromEntries(Object.entries(g.areas).map(([k, v]) => [k, v.score])),
  hardFails: g.hardFails,
  tokens: data.tokens ? { overall: data.tokens.overall, band: data.tokens.band } : null,
  platformBrief,
  medianReadyMs: median(data.states.map((s) => s.readyMs).filter(Boolean)),
});

if (cfg.teardown) await cfg.teardown({ seed }).catch(() => {});
await browser.close();
if (chromiumForFocus) await chromiumForFocus.close();
stopServer();
log(`gates: ${Object.entries(g.areas).map(([k, v]) => `${k} ${v.score ?? "-"}`).join(" · ")}${g.hardFails.length ? ` · ${g.hardFails.length} hard fails` : ""}`);
process.stdout.write(`${OUT}\n`);
