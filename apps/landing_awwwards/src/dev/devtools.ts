// TanStack Devtools for the landing, development only (Base.astro imports this behind
// import.meta.env.DEV, so a production build never sees it).
//
// The site uses none of the TanStack libraries, so there are no ready-made panels to plug in
// (Router, Query, Pacer and Hotkeys belong to the product app). What the panel offers instead
// are three plugins written for this site, on the framework-agnostic core:
//   Scroll   the Lenis/native scroll state, GSAP animations and every ScrollTrigger
//   Vitals   LCP, CLS, frame rate, long tasks (what an Awwwards jury measures)
//   Fonts    the loaded font faces, what the page really uses, characters the face lacks
import { TanStackDevtoolsCore, type TanStackDevtoolsPlugin } from "@tanstack/devtools";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { prefersReducedMotion, scrollState } from "../engine";

type Theme = "light" | "dark";
type Row = [label: string, value: string, tone?: "ok" | "warn" | "bad"];

const cleanups = new Map<string, () => void>();

const n = (v: number, digits = 0) => (Number.isFinite(v) ? v.toFixed(digits) : "–");

type Action = { label: string; run: () => void };

/** One two-column table of facts, then buttons and a note. Built with DOM calls, never markup. */
function paint(el: HTMLElement, theme: Theme, rows: Row[], actions: Action[] = [], note = "") {
  const dark = theme === "dark";
  const fg = dark ? "#e8e8e8" : "#161616";
  const mute = dark ? "#8f8f8f" : "#6b6b6b";
  const line = dark ? "#2a2a2a" : "#e2e2e2";
  const tone = { ok: "#3fc168", warn: "#f9ad26", bad: "#f0524f" };
  // The host element keeps the layout the devtools gave it; the look goes on a wrapper inside it.
  const root = document.createElement("div");
  root.style.cssText = `padding:14px 16px;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:${fg};box-sizing:border-box;min-height:100%`;
  const table = document.createElement("table");
  table.style.cssText = "border-collapse:collapse;width:100%";
  for (const [label, value, t] of rows) {
    const tr = table.insertRow();
    tr.style.borderBottom = `1px solid ${line}`;
    const k = tr.insertCell();
    k.style.cssText = `padding:5px 12px 5px 0;color:${mute};white-space:pre;vertical-align:top`;
    k.textContent = label;
    const v = tr.insertCell();
    v.style.cssText = `padding:5px 0;${t ? `color:${tone[t]}` : ""}`;
    v.textContent = value;
  }
  const kids: Node[] = [table];
  for (const a of actions) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = a.label;
    b.style.cssText = `margin:12px 8px 0 0;padding:6px 12px;border-radius:6px;border:1px solid ${dark ? "#3a3a3a" : "#cfcfcf"};background:transparent;color:inherit;font:inherit;cursor:pointer`;
    b.addEventListener("click", a.run);
    kids.push(b);
  }
  if (note) {
    const p = document.createElement("p");
    p.style.cssText = "margin:12px 0 0;opacity:.6";
    p.textContent = note;
    kids.push(p);
  }
  root.append(...kids);
  el.replaceChildren(root);
}

/** Re-render `draw` every `ms` while the plugin is mounted; remembered per plugin id for destroy. */
function live(id: string, el: HTMLElement, ms: number, draw: () => void) {
  cleanups.get(id)?.();
  draw();
  const t = window.setInterval(draw, ms);
  cleanups.set(id, () => window.clearInterval(t));
}

// ---------------------------------------------------------------- Scroll
const scrollPlugin: TanStackDevtoolsPlugin = {
  id: "moduo-scroll",
  name: "Scroll",
  render(el, { theme }) {
    const draw = () => {
      const s = scrollState();
      const max = document.documentElement.scrollHeight - innerHeight;
      const all = ScrollTrigger.getAll();
      const active = all.filter((t) => t.isActive).length;
      const html = document.documentElement.classList;
      const rows: Row[] = [
        ["route", location.pathname],
        ["scroll", `${n(s.y)} / ${n(max)} px · ${n(s.progress * 100)}%`],
        ["velocity", `${n(s.velocity, 2)}`],
        [
          "engine",
          prefersReducedMotion() ? "native scroll (reduced motion)" : "Lenis on the GSAP ticker",
          prefersReducedMotion() ? "warn" : "ok",
        ],
        ["viewport", `${innerWidth} × ${innerHeight} @${devicePixelRatio}x`],
        [
          "<html>",
          [...html].filter((c) => ["js", "motion", "intro", "is-booted"].includes(c)).join(" ") ||
            "no flags",
          html.contains("is-booted") ? "ok" : "warn",
        ],
        [
          "GSAP",
          `${gsap.version} · ${gsap.globalTimeline.getChildren(true, true, true).length} animations alive`,
        ],
        ["ScrollTrigger", `${all.length} triggers · ${active} active`],
      ];
      for (const t of all.slice(0, 16)) {
        const target =
          t.trigger instanceof Element
            ? `${t.trigger.tagName.toLowerCase()}${t.trigger.className ? "." + String(t.trigger.className).split(" ")[0] : ""}`
            : "(none)";
        rows.push([
          `  ${t.isActive ? "●" : "○"} ${target}`,
          `${n(t.start)} → ${n(t.end)} · ${n(t.progress * 100)}%`,
          t.isActive ? "ok" : undefined,
        ]);
      }
      if (all.length > 16) rows.push(["  …", `${all.length - 16} more`]);
      paint(el, theme, rows, [
        { label: "ScrollTrigger.refresh()", run: () => ScrollTrigger.refresh() },
      ]);
    };
    live("moduo-scroll", el, 400, draw);
  },
  destroy: (id) => cleanups.get(id)?.(),
};

// ---------------------------------------------------------------- Vitals
const vitals = { lcp: NaN, cls: 0, longTasks: 0, longTaskMs: 0, fps: 0, fpsAvg: 0, worst: 0 };
let vitalsStarted = false;

function startVitals() {
  if (vitalsStarted) return;
  vitalsStarted = true;
  const observe = (type: string, cb: (e: PerformanceEntry) => void) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(cb)).observe({
        type,
        buffered: true,
      });
    } catch {
      // the browser does not report this entry type
    }
  };
  observe("largest-contentful-paint", (e) => (vitals.lcp = e.startTime));
  observe("layout-shift", (e) => {
    const ls = e as PerformanceEntry & { value: number; hadRecentInput: boolean };
    if (!ls.hadRecentInput) vitals.cls += ls.value;
  });
  observe("longtask", (e) => {
    vitals.longTasks += 1;
    vitals.longTaskMs += e.duration;
  });
  // frame rate: frames per second over the last second, the average since mount, the worst frame in 5 s
  let last = performance.now();
  let frames = 0;
  let second = last;
  const t0 = last;
  let total = 0;
  const recent: { at: number; dt: number }[] = [];
  const loop = (now: number) => {
    const dt = now - last;
    last = now;
    frames += 1;
    total += 1;
    recent.push({ at: now, dt });
    while (recent.length && now - recent[0].at > 5000) recent.shift();
    vitals.worst = Math.max(0, ...recent.map((r) => r.dt));
    if (now - second >= 1000) {
      vitals.fps = (frames * 1000) / (now - second);
      vitals.fpsAvg = (total * 1000) / (now - t0);
      frames = 0;
      second = now;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

const vitalsPlugin: TanStackDevtoolsPlugin = {
  id: "moduo-vitals",
  name: "Vitals",
  render(el, { theme }) {
    const draw = () => {
      const nav = performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined;
      const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? NaN;
      const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      const rate = (v: number, good: number, poor: number): Row[2] =>
        Number.isNaN(v) ? undefined : v <= good ? "ok" : v <= poor ? "warn" : "bad";
      const rows: Row[] = [
        ["LCP", `${n(vitals.lcp)} ms`, rate(vitals.lcp, 2500, 4000)],
        ["CLS", n(vitals.cls, 3), rate(vitals.cls, 0.1, 0.25)],
        ["FCP", `${n(fcp)} ms`, rate(fcp, 1800, 3000)],
        ["TTFB", `${n(nav?.responseStart ?? NaN)} ms`],
        [
          "frame rate",
          `${n(vitals.fps)} fps now · ${n(vitals.fpsAvg)} avg`,
          vitals.fps >= 55 ? "ok" : vitals.fps >= 40 ? "warn" : "bad",
        ],
        ["worst frame (5 s)", `${n(vitals.worst, 1)} ms`, rate(vitals.worst, 20, 34)],
        [
          "long tasks",
          `${vitals.longTasks} · ${n(vitals.longTaskMs)} ms blocked`,
          vitals.longTasks === 0 ? "ok" : vitals.longTaskMs < 200 ? "warn" : "bad",
        ],
        ["JS heap", mem ? `${n(mem.usedJSHeapSize / 1048576, 1)} MB` : "not reported"],
        ["requests", `${performance.getEntriesByType("resource").length}`],
      ];
      paint(
        el,
        theme,
        rows,
        [],
        "Development build: Vite serves unbundled modules, so LCP and request counts read worse than production. CLS, frame rate and long tasks are the ones to trust here.",
      );
    };
    startVitals();
    live("moduo-vitals", el, 500, draw);
  },
  destroy: (id) => cleanups.get(id)?.(),
};

// ---------------------------------------------------------------- Fonts
function visibleChars(): string[] {
  const seen = new Set<string>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest("script,style,noscript,#moduo-devtools")) continue;
    for (const ch of node.textContent ?? "") if (ch.trim()) seen.add(ch);
  }
  return [...seen].sort();
}

/** Characters the first family in --f-sans cannot draw: same width in "Family, monospace" and in monospace. */
function lacking(family: string, chars: string[]): string[] {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return [];
  const width = (font: string, ch: string) => {
    ctx.font = font;
    return ctx.measureText(ch).width;
  };
  return chars.filter(
    (ch) => width(`48px ${family}, monospace`, ch) === width("48px monospace", ch),
  );
}

const fontsPlugin: TanStackDevtoolsPlugin = {
  id: "moduo-fonts",
  name: "Fonts",
  render(el, { theme }) {
    const draw = (scan = false) => {
      const stack = getComputedStyle(document.documentElement).getPropertyValue("--f-sans").trim();
      const first = stack.split(",")[0]?.trim() || "sans-serif";
      const h1 = document.querySelector("h1");
      const faces = [...document.fonts];
      const rows: Row[] = [
        ["--f-sans", stack || "(unset)"],
        ["body", describe(document.body)],
        ["h1", h1 ? describe(h1) : "(none on this page)"],
        [
          "faces",
          `${faces.filter((f) => f.status === "loaded").length} loaded of ${faces.length} declared`,
        ],
      ];
      for (const f of faces) {
        rows.push([
          `  ${f.family.replace(/"/g, "")} ${f.weight}`,
          `${f.status}${f.unicodeRange && f.unicodeRange !== "U+0-10FFFF" ? " · " + f.unicodeRange.slice(0, 36) + "…" : ""}`,
          f.status === "loaded" ? "ok" : f.status === "error" ? "bad" : undefined,
        ]);
      }
      const chars = visibleChars();
      const missing = scan ? lacking(first, chars) : null;
      rows.push(["characters on page", `${chars.length} distinct`]);
      if (missing)
        rows.push([
          `not in ${first.replace(/"/g, "")}`,
          missing.length ? missing.join(" ") : "none",
          missing.length ? "warn" : "ok",
        ]);
      paint(el, theme, rows, [
        { label: "Scan page for missing glyphs", run: () => draw(true) },
        { label: "Refresh", run: () => draw(false) },
      ]);
    };
    cleanups.get("moduo-fonts")?.();
    draw(false);
    document.fonts.addEventListener("loadingdone", () => draw(false));
  },
};

function describe(node: Element): string {
  const s = getComputedStyle(node);
  return `${s.fontFamily.split(",")[0].replace(/"/g, "")} ${s.fontWeight} · ${s.fontSize} · tracking ${s.letterSpacing}`;
}

// ---------------------------------------------------------------- mount
let core: TanStackDevtoolsCore | null = null;

export function mountDevtools() {
  if (core) return;
  const host = document.createElement("div");
  host.id = "moduo-devtools";
  // On <html>, not <body>: the view-transition router swaps the body on every navigation.
  document.documentElement.append(host);
  core = new TanStackDevtoolsCore({
    plugins: [scrollPlugin, vitalsPlugin, fontsPlugin],
    config: { position: "middle-right" },
  });
  core.mount(host);
  // The panel's styles live in one <style id="_goober"> in <head>, which the router also swaps out.
  const style = document.getElementById("_goober");
  document.addEventListener("astro:after-swap", () => {
    if (style && !style.isConnected) document.head.append(style);
  });
}
