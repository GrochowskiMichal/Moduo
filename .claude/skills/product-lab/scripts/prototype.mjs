#!/usr/bin/env node
// Renders a single-file HTML prototype (the studio's artifact) into a small dossier the blind
// critic can read: one frame per declared state, the window-size matrix, a keyboard focus walk,
// pointer feedback, axe and token conformance against the project's token files. No server,
// no seed, no sign-in: the prototype carries its own fictional data.
//
// The prototype declares its states on window.studio (see references/prototype.md):
//   window.studio = { states: [{ id, label }], set(id) }   // set may return a promise
//
// Usage: node prototype.mjs <file.html> [--label name] [--tokens a.css,b.css] [--engine webkit]
//                           [--purpose "..."] [--users "..."] [--platform macos-desktop]
//                           [--windows 1024x700,1280x800,1440x900,1920x1080] [--theme dark]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PROBE, focusInfo, hoverTargets, pageInfo, settle } from "./lib/probe.mjs";
import { launch, loadAxe, runAxe } from "./lib/pw.mjs";
import { contactSheet, crop } from "./lib/sheet.mjs";
import { harvest, resolveTokens, score, shadowLayers, toRgba, tokenNames } from "./lib/tokens.mjs";
import { list, log, mkdirp, pad, parseArgs, rel, runId, slug, writeJson, writeText } from "./lib/util.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.cwd();
const args = parseArgs(process.argv.slice(2), ["label", "tokens", "engine", "purpose", "users", "platform", "windows", "theme", "out"]);
const file = args._[0] && path.resolve(args._[0]);
if (!file || !fs.existsSync(file)) {
  console.error("usage: node prototype.mjs <file.html> [--label name] [--tokens a.css,b.css]");
  process.exit(2);
}

const engine = args.engine ?? "webkit";
const theme = args.theme ?? "dark";
const viewport = { width: 1440, height: 900 };
const windows = (list(args.windows) ?? ["1024x700", "1280x800", "1440x900", "1920x1080"]).map((s) => s.split("x").map(Number));
const OUT = path.resolve(args.out ?? path.join(ROOT, ".lab", runId(args.label ?? `proto-${slug(path.basename(file, ".html"))}`)));
mkdirp(OUT);
// Critic mode: the page hides its tabs and rationale and shows only the product surface.
const url = `${pathToFileURL(file).href}?critic=1`;

const browser = await launch(engine);
const axeSource = await loadAxe();
const errors = new Set();

async function newPage({ size = viewport, using = browser, reducedMotion = "no-preference" } = {}) {
  const context = await using.newContext({ viewport: size, deviceScaleFactor: 1, colorScheme: theme === "dark" ? "dark" : "light", reducedMotion, locale: "en-US" });
  await context.addInitScript(PROBE);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.add(String(e.message).slice(0, 200)));
  page.on("console", (m) => m.type() === "error" && errors.add(m.text().slice(0, 200)));
  await page.goto(url);
  await page.waitForFunction(() => window.studio && Array.isArray(window.studio.states), null, { timeout: 10000 });
  await page.evaluate(settle, 800);
  return { context, page };
}

async function setState(page, id) {
  await page.evaluate(async (s) => {
    await window.studio.set(s);
  }, id);
  await page.evaluate(settle, 800);
}

const data = { meta: { file: path.basename(file), engine, theme, viewport }, states: [], windows: [], focus: [], hover: [], themes: [] };
let tokenTable = null;
const tokenRows = [];
const tokenFiles = list(args.tokens) ?? [];

// ── states ───────────────────────────────────────────────────────────────────────────────
{
  const { context, page } = await newPage();
  const states = await page.evaluate(() => window.studio.states.map((s) => ({ id: s.id, label: s.label ?? s.id })));
  log(`${states.length} states`);
  for (const st of states) {
    const rec = { id: st.id, label: st.label };
    try {
      await setState(page, st.id);
      rec.file = path.join(OUT, "states", `${slug(st.id)}.png`);
      mkdirp(path.dirname(rec.file));
      await page.screenshot({ path: rec.file });
      rec.info = await page.evaluate(pageInfo);
      rec.info.blank = rec.info.textLength < 10 || rec.info.visibleElements < 5;
      rec.axe = await runAxe(page, axeSource).catch((e) => ({ skipped: `axe failed: ${e.message}` }));
      if (tokenFiles.length) {
        if (!tokenTable) tokenTable = await page.evaluate(resolveTokens, tokenNames(tokenFiles, ROOT));
        const rows = await page.evaluate(harvest, { exclude: [], max: 6000 });
        for (const r of rows) tokenRows.push({ ...r, state: st.id, file: rec.file });
      }
    } catch (e) {
      rec.error = String(e.message).split("\n")[0].slice(0, 160);
    }
    data.states.push(rec);
  }
  // Window sizes and reduced motion on the first (default) state.
  const first = states[0]?.id;
  if (first) {
    await setState(page, first);
    for (const [w, h] of windows) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(250);
      await page.evaluate(settle, 600);
      const out = path.join(OUT, "windows", `${w}x${h}.png`);
      mkdirp(path.dirname(out));
      await page.screenshot({ path: out });
      const wi = await page.evaluate(pageInfo);
      data.windows.push({ w, h, file: out, overflowX: wi.overflowX, offenders: wi.offenders });
    }
  }
  await context.close();
}

// ── reduced motion, focus walk (Chromium: Safari's engine tabs only to fields) ────────────
{
  const { context, page } = await newPage({ reducedMotion: "reduce" });
  const out = path.join(OUT, "themes", "reduced-motion.png");
  mkdirp(path.dirname(out));
  await page.screenshot({ path: out });
  data.themes.push({ reducedMotion: true, file: out });
  await context.close();
}
const chromium = engine === "chromium" ? browser : await launch("chromium");
{
  const { context, page } = await newPage({ using: chromium });
  let last = null;
  let repeats = 0;
  for (let n = 1; n <= 30; n++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(100);
    const info = await page.evaluate(focusInfo);
    info.n = n;
    const key = `${info.tag}|${info.name}|${Math.round(info.rect?.x ?? 0)}|${Math.round(info.rect?.y ?? 0)}`;
    repeats = key === last ? repeats + 1 : 0;
    last = key;
    if (!info.none && info.inViewport) {
      const r = info.rect;
      const w = Math.max(360, r.width + 160);
      const h = Math.max(160, r.height + 96);
      const x = Math.max(0, Math.min(viewport.width - w, r.x + r.width / 2 - w / 2));
      const y = Math.max(0, Math.min(viewport.height - h, r.y + r.height / 2 - h / 2));
      info.file = path.join(OUT, "focus", `k-${pad(n)}.png`);
      mkdirp(path.dirname(info.file));
      await page.screenshot({ path: info.file, clip: { x, y, width: Math.min(w, viewport.width), height: Math.min(h, viewport.height) } });
    }
    data.focus.push(info);
    if (repeats >= 2) break;
  }
  await context.close();
}
{
  const { context, page } = await newPage();
  const targets = await page.evaluate(hoverTargets, { selector: "button, a[href], [role=button], [role=tab], [role=menuitem], [role=option], [role=treeitem], input, [tabindex='0']", max: 12 });
  for (const [i, t] of targets.entries()) {
    const n = pad(i + 1);
    const clip = { x: Math.max(0, t.x - 40), y: Math.max(0, t.y - 24), width: Math.min(viewport.width - Math.max(0, t.x - 40), t.width + 80), height: Math.min(viewport.height - Math.max(0, t.y - 24), t.height + 48) };
    const rest = path.join(OUT, "hover", `h-${n}-rest.png`);
    const hover = path.join(OUT, "hover", `h-${n}-hover.png`);
    mkdirp(path.dirname(rest));
    await page.mouse.move(0, 0);
    await page.waitForTimeout(150);
    await page.screenshot({ path: rest, clip });
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
    await page.waitForTimeout(250);
    await page.screenshot({ path: hover, clip });
    const same = fs.readFileSync(rest).equals(fs.readFileSync(hover));
    data.hover.push({ n: i + 1, name: t.name, tag: t.tag, rest, hover, changed: !same });
  }
  await context.close();
}
if (chromium !== browser) await chromium.close();

// ── tokens ───────────────────────────────────────────────────────────────────────────────
if (tokenTable) {
  const util = await browser.newContext();
  const p = await util.newPage();
  await p.setContent("<!doctype html><title>lab</title>");
  const colors = new Set([...tokenRows.filter((r) => r.fam === "color").map((r) => r.value), ...tokenTable.filter((t) => t.kind === "color").map((t) => t.value), ...tokenRows.filter((r) => r.fam === "shadow").flatMap((r) => shadowLayers(r.value).map((l) => l.color).filter(Boolean))]);
  const rgba = await p.evaluate(toRgba, [...colors]);
  await util.close();
  data.tokens = score(tokenRows, tokenTable, rgba);
  for (const [i, t] of data.tokens.top.entries()) {
    const w = t.where[0];
    const row = tokenRows.find((r) => r.state === w?.state);
    if (!w || !row) continue;
    t.crop = await crop(browser, row.file, { x: w.x, y: w.y, w: w.w, h: w.h }, path.join(mkdirp(path.join(OUT, "tokens")), `drift-${pad(i + 1)}.png`), { pad: 32 }).catch(() => null);
  }
  writeJson(path.join(OUT, "tokens.json"), { ...data.tokens, tokens: tokenTable });
}

// ── sheets ───────────────────────────────────────────────────────────────────────────────
const visual = [];
const sheet = async (items, out, title, opts) => contactSheet(browser, items, out, { title, ...opts });
const states = await sheet(data.states.filter((s) => s.file).map((s) => ({ file: s.file, caption: `${path.basename(s.file)}: ${s.label}` })), path.join(OUT, "states", "sheet.png"), "Every declared state");
if (states) visual.push({ title: "Every state of the surface", files: [states] });
const win = await sheet(data.windows.map((w) => ({ file: w.file, caption: `${w.w}x${w.h}` })), path.join(OUT, "windows", "sheet.png"), "Window sizes");
if (win) visual.push({ title: "Window sizes, first state", files: [win] });
visual.push({ title: "Reduced motion", files: data.themes.map((t) => t.file) });
const focus = await sheet(data.focus.filter((f) => f.file).map((f) => ({ file: f.file, caption: `k-${pad(f.n)} ${f.tag} "${f.name ?? ""}"` })), path.join(OUT, "focus", "sheet.png"), "Keyboard focus, Tab by Tab", { columns: 4 });
if (focus) visual.push({ title: "Keyboard focus stops", files: [focus] });
const hov = await sheet(data.hover.flatMap((h) => [{ file: h.rest, caption: `h-${pad(h.n)} rest` }, { file: h.hover, caption: `h-${pad(h.n)} hover` }]), path.join(OUT, "hover", "sheet.png"), "Pointer targets at rest and under the pointer", { columns: 4 });
if (hov) visual.push({ title: "Pointer feedback pairs", files: [hov] });
if (data.tokens?.top?.some((t) => t.crop)) visual.push({ title: "Crops of the most common off-token values (see measurements.md)", files: data.tokens.top.filter((t) => t.crop).map((t) => t.crop) });
await browser.close();

// ── write ────────────────────────────────────────────────────────────────────────────────
const table = (head, rows) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const axeRules = new Map();
for (const s of data.states) for (const v of s.axe?.violations ?? []) {
  const r = axeRules.get(v.id) ?? { id: v.id, impact: v.impact, help: v.help, nodes: 0, states: new Set() };
  r.nodes += v.count;
  r.states.add(s.id);
  axeRules.set(v.id, r);
}
const realStops = data.focus.filter((f) => !f.none);
const noRing = realStops.filter((f) => f.inViewport && !f.indicator);
const m = ["# Measurements", ""];
m.push("## States", "", table(["state", "blank", "horizontal overflow", "error"], data.states.map((s) => [s.id, s.info?.blank ? "yes" : "no", s.info?.overflowX ? "yes" : "no", s.error ?? ""])));
m.push("", "## Window sizes", "", table(["window", "horizontal overflow", "wider elements"], data.windows.map((w) => [`${w.w}x${w.h}`, w.overflowX ? "yes" : "no", w.offenders.join(", ")])));
m.push("", "## Accessibility (axe)", "", axeRules.size ? table(["rule", "impact", "nodes", "states", "what"], [...axeRules.values()].map((r) => [r.id, r.impact, r.nodes, [...r.states].join(", "), r.help])) : "No violations.");
m.push("", "## Keyboard focus", "", `${data.focus.length} Tab presses; ${realStops.length} reached a control; ${noRing.length} without a visible change when focused${noRing.length ? ` (${noRing.slice(0, 6).map((f) => `k-${pad(f.n)} ${f.tag} "${f.name}"`).join(", ")})` : ""}.`);
m.push("", "## Pointer feedback", "", `${data.hover.length} targets; ${data.hover.filter((h) => !h.changed).length} show no change under the pointer${data.hover.some((h) => !h.changed) ? ` (${data.hover.filter((h) => !h.changed).map((h) => `h-${pad(h.n)} "${h.name}"`).join(", ")})` : ""}.`);
if (data.tokens?.top?.length) m.push("", "## Values off the design tokens", "", table(["#", "property", "value", "nearest token", "distance", "elements", "crop"], data.tokens.top.map((t, i) => [i + 1, t.prop, t.value, t.nearest, t.distance, t.count, t.crop ? rel(OUT, t.crop) : ""])));
m.push("", `Runtime errors: ${errors.size ? [...errors].join("; ") : "none"}.`);
writeText(path.join(OUT, "measurements.md"), m.join("\n"));

const c = ["# Evidence for review", ""];
c.push("## The product", "", `- What it is for: ${args.purpose ?? "not stated"}`, `- Who uses it: ${args.users ?? "not stated"}`, `- Platform: ${args.platform ?? "web"} (conventions: ${path.join(HERE, "..", "references", "platform-brief.md")})`, `- Primary theme: ${theme}`, `- What you are looking at: a high-fidelity prototype of one module, rendered in ${engine === "webkit" ? "Safari's engine (WebKit)" : engine} at ${viewport.width}x${viewport.height}. Data is fictional. Judge it as the shipped module.`, "");
c.push("## Part A: look first", "", "Open every file below before Part B. Each sheet is a montage; its frames are saved full size in the same folder (the captions give the names).", "");
for (const g of visual) c.push(`- ${g.title}: ${g.files.map((f) => `\`${rel(OUT, f)}\``).join(", ")}`);
c.push("", "## Part B: measurements", "", "After your observations: `measurements.md`.", "");
c.push("## What this evidence cannot show", "", "- Journeys and their key counts: a prototype has no scripted journeys, so judge flow from the states.", "- Latency, frame timing and how motion feels.", "- Native menus, window chrome and system shortcuts.", "- Real data volume, sync and the backend.");
writeText(path.join(OUT, "critic.md"), c.join("\n"));

const gates = {
  accessibility: Math.max(0, 10 - 3 * [...axeRules.values()].filter((r) => r.impact === "critical").length - 1.5 * [...axeRules.values()].filter((r) => r.impact === "serious").length - (noRing.length ? 2 : 0)),
  states: data.states.length ? Math.round((10 * data.states.filter((s) => s.file && !s.info?.blank && !s.error).length) / data.states.length * 10) / 10 : 0,
  reliability: errors.size ? Math.max(0, 10 - 2 * errors.size) : 10,
  layout: data.windows.some((w) => w.overflowX) ? 6 : 10,
  system: data.tokens ? Math.round(data.tokens.overall) / 10 : null,
  pointer: data.hover.length ? Math.round((10 * data.hover.filter((h) => h.changed).length) / data.hover.length * 10) / 10 : null,
};
writeJson(path.join(OUT, "gates.json"), { kind: "prototype", areas: gates });
writeJson(path.join(OUT, "summary.json"), { ...data, errors: [...errors], states: data.states.map(({ axe, ...s }) => s) });
writeText(path.join(OUT, "dossier.md"), [`# Prototype run ${path.basename(OUT)}`, "", `${data.meta.file} · ${data.states.length} states · ${engine}`, "", "## Gates (computed by code)", "", table(["area", "score"], Object.entries(gates).map(([k, v]) => [k, v ?? "not measured"])), "", "Critic reads `critic.md`; everything else is for the studio."].join("\n"));
console.log(OUT);
