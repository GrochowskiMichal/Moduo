// Turns what the lab collected into the dossier's reports: feel.json (budget rows),
// gates.json (code-computed areas and caps), measurements.md (raw numbers for the critic, no
// verdicts), critic.md (the critic's index) and dossier.md (the full index). The bands and
// weights here are the ones in references/budgets.md.
import path from "node:path";

import { percentile, rel, round } from "./util.mjs";

const p = (v, q) => round(percentile(v, q), 0);

function band(row, value) {
  if (value == null) return null;
  const { full, partial, range } = row;
  if (range) {
    if (value >= range[0] && value <= range[1]) return "full";
    return value <= partial ? "partial" : "fail";
  }
  if (value <= full) return "full";
  if (value <= partial) return "partial";
  return "fail";
}

const WEIGHT = { 1: 3, 2: 3, 4: 3, 5: 2, 6: 2, 7: 2, 8: 2, 9: 2 };

export function feelRows(data) {
  const steps = data.journeys.flatMap((j) => j.steps.map((s) => ({ ...s, mode: j.mode })));
  const keySamples = steps.flatMap((s) => s.interactions.filter((i) => i.kind === "key").map((i) => i.duration));
  const clickSamples = steps.flatMap((s) => s.interactions.filter((i) => i.kind === "pointer").map((i) => i.duration));
  const keyMotion = steps.flatMap((s) => s.keyMotion ?? []);
  const views = steps.filter((s) => s.view && s.waitMs != null).map((s) => s.waitMs);
  const shifts = data.meta.layoutShift ? steps.map((s) => s.shift ?? 0) : [];
  const loafs = data.meta.loaf ? steps.flatMap((s) => s.loaf ?? []) : [];
  const ov = data.overlays.filter((o) => !o.error);
  const menus = ov.filter((o) => ["menu", "popover", "tooltip"].includes(o.kind) && o.entry);
  const dialogs = ov.filter((o) => !["menu", "popover", "tooltip"].includes(o.kind) && o.entry);
  const ratios = ov.filter((o) => o.ratio != null).map((o) => o.ratio);
  const easing = ov.filter((o) => o.entry?.duration > 0).map((o) => o.entry.easingClass);
  const rows = [];
  const add = (id, interaction, samples, spec, extra = {}) => {
    const value = spec.value ?? (samples.length ? percentile(samples, spec.pct ?? 95) : null);
    rows.push({
      id,
      interaction,
      n: samples.length,
      p50: p(samples, 50),
      p95: p(samples, 95),
      p99: p(samples, 99),
      value: value == null ? null : round(value, 2),
      band: band(spec, value),
      weight: WEIGHT[id] ?? 1,
      ...extra,
    });
  };
  add(1, "key press to next paint", keySamples, { full: 16, partial: 33 });
  add(2, "click to next paint", clickSamples, { full: 50, partial: 100 });
  add(4, "motion after keyboard-triggered actions", keyMotion, { full: 50, partial: 100 });
  add(5, "overlay input to first shown frame", ov.filter((o) => o.openMs != null).map((o) => o.openMs), { full: 50, partial: 100 });
  add(6, "menu or popover entry duration", menus.map((o) => o.entry.duration), { range: [120, 200], partial: 250 });
  add(7, "dialog, sheet or panel entry duration", dialogs.map((o) => o.entry.duration), { range: [200, 250], partial: 300 });
  add(8, "exit duration relative to entry", ratios, { full: 1, partial: 1.2 });
  add(9, "view switch to content usable", views, { full: 200, partial: 500 });
  if (data.meta.headed) {
    const dropped = ov.filter((o) => o.frames).map((o) => (o.frames.longest >= 50 || o.frames.consecutive >= 2 ? 2 : o.frames.dropped));
    add(10, "dropped frames while an overlay opens", dropped, { full: 0, partial: 1, pct: 100 });
  } else {
    rows.push({ id: 10, interaction: "dropped frames while an overlay opens", n: 0, value: null, band: null, note: "headless run: frame timing is software-rendered, not measured" });
  }
  if (data.meta.layoutShift) add(12, "layout shift per interaction step", shifts, { full: 0, partial: 0.01, pct: 100 });
  add(13, "interrupt: close at 40% then reopen (ms to settle)", ov.filter((o) => o.interrupt).map((o) => (o.interrupt.ok ? o.interrupt.settleMs : 9999)), { full: 400, partial: 800, pct: 100 });
  const easeScore = easing.map((e) => (e === "decelerating" ? 0 : e === "standard" ? 1 : 2));
  add(14, "overlay entry easing (0 decelerating, 1 standard, 2 ease-in or linear)", easeScore, { full: 0, partial: 1, pct: 100 });
  const reduced = ov.filter((o) => o.reduced).map((o) => (o.reduced.moves ? 1 : 0));
  add(15, "overlays that still move under reduced motion", reduced, { full: 0, partial: 0, value: reduced.length ? reduced.reduce((a, b) => a + b, 0) : null });
  if (data.meta.loaf) add(17, "long animation frames during journeys (longest)", loafs, { full: 0, partial: 50, pct: 100, value: loafs.length ? Math.max(...loafs) : 0 });
  const p50 = percentile(clickSamples, 50);
  const p99 = percentile(clickSamples, 99);
  add(18, "click latency spread (p99 / p50)", clickSamples, { full: 2, partial: 3, value: p50 ? p99 / p50 : null });
  return rows;
}

const BAND_SCORE = { full: 10, partial: 6.5, fail: 3 };

export function gates(data, feel) {
  const areas = {};
  const ev = (a, s) => (areas[a].evidence ??= []).push(s);

  // accessibility
  const rules = new Map();
  for (const s of data.states) for (const v of s.axe?.violations ?? []) rules.set(v.id, v.impact);
  const crit = [...rules.values()].filter((i) => i === "critical").length;
  const serious = [...rules.values()].filter((i) => i === "serious").length;
  const moderate = [...rules.values()].filter((i) => i === "moderate").length;
  const stops = Object.values(data.focus).flatMap((f) => f.stops);
  const noRing = stops.filter((s) => !s.none && s.inViewport && !s.indicator).length;
  const movesReduced = data.overlays.some((o) => o.reduced?.moves);
  const axeRan = data.states.some((s) => s.axe && !s.axe.skipped);
  areas.accessibility = {
    score: axeRan || stops.length ? clamp(10 - 2 * crit - 1.5 * serious - Math.min(2, 0.5 * moderate) - Math.min(3, 0.5 * noRing) - (movesReduced ? 1 : 0)) : null,
  };
  ev("accessibility", `axe rules: ${crit} critical, ${serious} serious, ${moderate} moderate (a11y.json)`);
  ev("accessibility", `${noRing} of ${stops.length} focus stops with no visible indicator (focus/index.json)`);
  if (movesReduced) ev("accessibility", "an overlay still moves under reduced motion (overlays/index.json)");

  // performance
  const scored = feel.filter((r) => r.band);
  const wsum = scored.reduce((s, r) => s + r.weight, 0);
  areas.performance = { score: wsum ? round(scored.reduce((s, r) => s + r.weight * BAND_SCORE[r.band], 0) / wsum, 1) : null };
  for (const r of feel.filter((r) => r.band === "fail")) ev("performance", `row ${r.id} ${r.interaction}: ${r.value} (feel.json)`);
  if (!areas.performance.evidence) ev("performance", `${scored.length} feel rows measured, none failed`);

  // states
  const declared = data.states;
  const good = declared.filter((s) => s.file && !s.info?.blank && (s.state === "default" || !s.info?.sameAsDefault) && !s.error);
  const overflow = data.windows.filter((w) => w.overflowX);
  areas.states = { score: declared.length ? clamp((10 * good.length) / declared.length - (overflow.length ? 2 : 0)) : null };
  ev("states", `${good.length} of ${declared.length} declared states rendered, not blank, distinct (states/index.json)`);
  for (const s of declared.filter((s) => !good.includes(s))) ev("states", `${s.screen}/${s.state}: ${s.error ?? (s.info?.blank ? "blank" : "same as default")}`);
  for (const w of overflow) ev("states", `horizontal overflow at ${w.w}x${w.h} on ${w.screen}`);

  // reliability
  const errs = new Set([...data.errors.console, ...data.errors.page]);
  const incomplete = data.journeys.filter((j) => !j.completed);
  areas.reliability = { score: clamp(10 - Math.min(8, 1.5 * errs.size) - 2 * incomplete.length) };
  ev("reliability", `${errs.size} distinct console or page errors; ${data.errors.failedRequests.length} failed requests not injected`);
  for (const j of incomplete) ev("reliability", `journey ${j.id} (${j.mode}) did not complete: ${j.error}`);

  // platform (web proxy: keyboard journeys only)
  const kb = data.journeys.filter((j) => j.mode === "keyboard");
  areas.platform = kb.length
    ? { score: Math.min(7, round((10 * kb.filter((j) => j.completed).length) / kb.length, 1)), partial: true }
    : { score: null };
  ev("platform", data.meta.engine === "native" ? "native run" : "web proxy: menus, window chrome and accelerators not probed; capped at 7");

  // system
  areas.system = { score: data.tokens?.overall != null ? round(data.tokens.overall / 10, 1) : null };
  if (data.tokens?.overall != null) ev("system", `token conformance ${data.tokens.overall} (${data.tokens.band}), ${data.tokens.top.length} drift findings (tokens.json)`);

  const caps = [];
  const cap = (area, category, max) => {
    if (areas[area].score != null && areas[area].score < 6) caps.push({ category, max, because: `${area} gate ${areas[area].score}` });
  };
  cap("performance", "speed", 6);
  cap("states", "usability", 7);
  cap("reliability", "usability", 6);
  cap("platform", "platform", 6);
  cap("system", "craft", 7);

  const hardFails = [];
  for (const j of data.journeys) if (j.hardFail) hardFails.push({ kind: j.hardFail.kind, where: `journeys/${j.id}/${j.mode} ${j.hardFail.where}` });
  for (const s of data.states) if (s.info?.crashed) hardFails.push({ kind: "crash", where: `states/${s.screen}/${s.state}` });
  return { areas, hardFails, caps };
}

const clamp = (n) => round(Math.max(0, Math.min(10, n)), 1);

const table = (head, rows) =>
  rows.length ? [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map((c) => (c == null ? "" : String(c).replace(/\|/g, "/"))).join(" | ")} |`)].join("\n") : "_none_";

export function measurementsMd(data, feel, root) {
  const out = [`# Measurements`, "", `Engine: ${data.meta.engine}${data.meta.headed ? " (headed)" : " (headless)"}. Window ${data.meta.viewport.width}x${data.meta.viewport.height}. Numbers only; judging them is your job.`, ""];
  out.push("## Journeys: input cost", "");
  out.push(table(["journey", "mode", "completed", "keys", "clicks", "pointer travel px", "shortest known path"], data.journeys.map((j) => [j.id, j.mode, j.completed ? "yes" : `no: ${j.error}`, j.counts.keys, j.counts.clicks, Math.round(j.counts.travel), j.target ? `${j.target.keys ?? "?"} keys, ${j.target.clicks ?? "?"} clicks` : ""])));
  out.push("", "## Latency and motion (ms unless noted)", "");
  out.push(table(["#", "interaction", "n", "p50", "p95", "p99", "value used"], feel.map((r) => [r.id, r.interaction, r.n, r.p50, r.p95, r.p99, r.value ?? r.note ?? ""])));
  out.push("", "## Overlays", "");
  out.push(table(["overlay", "kind", "entry ms", "entry easing", "animated properties", "exit ms", "interrupt", "under reduced motion"], data.overlays.map((o) => [o.id, o.kind, o.entry?.duration ?? o.error, o.entry?.easing, o.entry?.props?.join(" "), o.exit?.duration, o.interrupt ? (o.interrupt.ok ? `settled in ${o.interrupt.settleMs} ms` : "did not end open") : "", o.reduced ? (o.reduced.moves ? "still moves" : "no movement") : ""])));
  out.push("", "## States", "");
  out.push(table(["screen", "state", "file", "text chars", "visible elements", "differs from default", "note"], data.states.map((s) => [s.screen, s.state, s.file ? rel(root, s.file) : "", s.info?.textLength, s.info?.visibleElements, s.state === "default" ? "" : s.info?.sameAsDefault ? "no" : "yes", s.error ?? (s.info?.overflowX ? "horizontal overflow" : "")])));
  out.push("", "## Window sizes", "");
  out.push(table(["screen", "size", "horizontal overflow", "widest offenders"], data.windows.map((w) => [w.screen, `${w.w}x${w.h}`, w.overflowX ? `yes (${w.scrollWidth}px)` : "no", w.offenders?.join("; ")])));
  out.push("", "## Accessibility (axe-core, WCAG 2.2 A/AA)", "");
  const rules = new Map();
  for (const s of data.states) for (const v of s.axe?.violations ?? []) {
    const r = rules.get(v.id) ?? { ...v, screens: new Set(), count: 0 };
    r.screens.add(`${s.screen}/${s.state}`);
    r.count += v.count;
    rules.set(v.id, r);
  }
  out.push(table(["rule", "impact", "nodes", "where", "example"], [...rules.values()].map((r) => [r.id, r.impact, r.count, [...r.screens].slice(0, 4).join(", "), r.targets?.[0]])));
  const contrast = [...rules.values()].flatMap((r) => r.contrast ?? []).slice(0, 10);
  if (contrast.length) out.push("", table(["contrast ratio", "needed", "text", "background", "element"], contrast.map((c) => [c.ratio, c.expected, c.fg, c.bg, c.target])));
  out.push("", "## Keyboard focus", "");
  for (const [screen, f] of Object.entries(data.focus)) {
    const noRing = f.stops.filter((s) => !s.none && s.inViewport && !s.indicator);
    const real = f.stops.filter((s) => !s.none);
    const trapped = f.stops.some((s) => s.trapped);
    out.push(`- ${screen}: ${f.stops.length} Tab presses (in Chromium); ${real.length} reached a control; ${noRing.length} without a visible change when focused${noRing.length ? ` (${noRing.slice(0, 5).map((s) => `k-${String(s.n).padStart(2, "0")} ${s.tag} "${s.name}"`).join(", ")})` : ""}; ${real.filter((s) => s.hidden || !s.inViewport).length} focused something invisible or off screen; ${f.stops.length - real.length} left the page; first stop: ${real[0]?.tag ?? "none"} "${real[0]?.name ?? ""}"${trapped ? "; focus stopped moving (possible trap)" : ""}`);
  }
  out.push("", "## Pointer feedback", "");
  for (const [screen, h] of Object.entries(data.hover)) {
    const none = h.filter((x) => !x.changed.length);
    out.push(`- ${screen}: ${h.length} targets; ${none.length} show no change under the pointer${none.length ? ` (${none.map((x) => `h-${String(x.n).padStart(2, "0")} "${x.name}"`).join(", ")})` : ""}; colour-only changes: ${h.filter((x) => x.changed.length && x.changed.every((c) => /color/.test(c))).length}`);
  }
  if (data.tokens?.top?.length) {
    out.push("", "## Values off the design tokens", "", "The most frequent rendered values that are not a token: near-misses sit just beside one.", "");
    out.push(table(["#", "property", "value", "nearest token", "distance", "elements", "crop"], data.tokens.top.map((t, i) => [i + 1, t.prop, t.value, t.nearest, t.distance, t.count, t.crop ? rel(root, t.crop) : ""])));
  }
  return out.join("\n");
}

export function criticMd(data, cfg, root, groups) {
  const out = ["# Evidence for review", ""];
  out.push("## The product", "", `- What it is for: ${cfg.purpose ?? "not stated"}`, `- Who uses it: ${cfg.users ?? "not stated"}`, `- Platform: ${cfg.platform ?? "web"} (conventions: ${groups.platformBrief})`, `- Primary theme: ${cfg.primaryTheme ?? "light"}`, `- Captured with: ${data.meta.engine === "webkit" ? "Safari's engine (WebKit) as a stand-in for the desktop app's webview" : data.meta.engine}; window ${data.meta.viewport.width}x${data.meta.viewport.height}`, "");
  out.push("## Journey goals", "");
  const seen = new Set();
  for (const j of data.journeys) {
    if (seen.has(j.id)) continue;
    seen.add(j.id);
    const modes = data.journeys.filter((x) => x.id === j.id).map((x) => x.mode).join(" and ");
    out.push(`- **${j.id}**: ${j.goal} (run ${modes})`);
  }
  out.push("", "## Part A: look first", "", "Open every file below before Part B. Write your observations from these alone. Each sheet is a montage; its frames are saved full size in the same folder (the captions give the names), so open one when a detail is too small to judge.", "");
  for (const g of groups.visual) out.push(`- ${g.title}: ${g.files.map((f) => `\`${rel(root, f)}\``).join(", ")}${g.note ? `. ${g.note}` : ""}`);
  out.push("", "## Part B: measurements", "", "After your observations: `measurements.md`.", "");
  out.push("## What this evidence cannot show", "", "- How motion feels beyond the numbers; sound; learning the product over weeks; real users' behaviour.");
  if (data.meta.engine !== "native") out.push("- Native menus, window chrome and system shortcuts: this run used a browser stand-in for the desktop app.");
  if (!data.meta.headed) out.push("- Frame smoothness: the run was headless, so frame timing was not measured.");
  return out.join("\n");
}

export function dossierMd(data, gatesOut, feel, root) {
  const g = gatesOut.areas;
  const out = [`# Lab run ${path.basename(root)}`, ""];
  out.push(`Engine ${data.meta.engine}${data.meta.headed ? " headed" : " headless"} · ${data.states.length} states · ${data.journeys.length} journey runs · ${data.overlays.length} overlays${data.meta.ablations.length ? ` · **ablated: ${data.meta.ablations.join(", ")}**` : ""}`, "");
  out.push("## Gates (computed by code)", "");
  out.push(table(["area", "score", "evidence"], Object.entries(g).map(([k, v]) => [k, v.score ?? "not measured", (v.evidence ?? []).join("; ")])));
  if (gatesOut.hardFails.length) out.push("", "**Hard fails:**", ...gatesOut.hardFails.map((h) => `- ${h.kind}: ${h.where}`));
  if (gatesOut.caps.length) out.push("", "**Caps for the jury:**", ...gatesOut.caps.map((c) => `- ${c.category} max ${c.max} (${c.because})`));
  out.push("", "## Feel", "", table(["#", "interaction", "p95/value", "band"], feel.map((r) => [r.id, r.interaction, r.value ?? r.note ?? "", r.band ?? ""])));
  if (data.tokens) out.push("", `## Tokens`, "", `Conformance ${data.tokens.overall} (${data.tokens.band}) over ${data.tokens.tokenCount} tokens.`, "", table(["family", "observations", "coverage %", "near-miss values", "off-system values", "effective values", "score"], Object.entries(data.tokens.families).map(([k, f]) => [k, f.observations, f.coverage, f.nearMissValues, f.offSystemValues, f.effectiveValues.d1, f.score])));
  if (data.impeccable) out.push("", "## Impeccable detector (builder only, never the critic)", "", "`impeccable.json`: " + (data.impeccable.summary ?? data.impeccable.skipped ?? ""));
  out.push("", "## Files", "", "- `critic.md` and `measurements.md`: what the blind critic reads", "- `gates.json`, `feel.json`, `tokens.json`, `a11y.json`, `summary.json`: machine-readable");
  return out.join("\n");
}
