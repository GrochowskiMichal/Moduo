// CV-0 spike 1: the scenario runner. Runs inside the page, so the same code
// measures Chromium (Playwright) and the Tauri app's WKWebView; posts one
// JSON per library to the collector (scripts/spikes/chat/s1/collect.ts).

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { control, type HarnessState } from "./app";
import { arrival, COUNT, editGrowth, MESSAGES, type Msg, SCENARIO_CHAINS } from "./fixture";
import {
  BASE_CONFIG,
  type Density,
  RECOMMENDED,
  type Row,
  type StreamConfig,
  windowRows,
} from "./model";
import { longFrames, PaintProbe, raf, round, sleep, stats, waitFrames } from "./probe";
import { RowView } from "./rows";
import { STREAMS } from "./streams";

type Value = number | string | boolean | null | number[] | Record<string, unknown>;
export type Result = {
  scenario: string;
  lib: string;
  config: string;
  bar: string;
  pass: boolean | null;
  metrics: Record<string, Value>;
  note?: string;
};

const probe = new PaintProbe();
let maxElements = 0;
let maxElementsWhere = "";
let currentScenario = "";

const id = (seq: number) => (MESSAGES[seq] as Msg).id;
const NEWEST = { lo: COUNT - 50, hi: COUNT };

function api() {
  const a = control.api();
  if (!a) throw new Error("no stream mounted");
  return a;
}

function scroller(): HTMLElement {
  const el = api().scroller();
  if (!el) throw new Error("no scroller");
  return el;
}

function countElements(): number {
  const n = scroller().querySelectorAll("*").length;
  if (n > maxElements) {
    maxElements = n;
    maxElementsWhere = currentScenario;
  }
  return n;
}

function rowEl(key: string): HTMLElement | null {
  for (const el of scroller().querySelectorAll<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)) {
    if (el.dataset.sticky === undefined) return el;
  }
  return null;
}

function rowRect(key: string): { top: number; bottom: number } | null {
  const el = rowEl(key);
  if (!el) return null;
  const base = scroller().getBoundingClientRect().top;
  const r = el.getBoundingClientRect();
  return { top: r.top - base, bottom: r.bottom - base };
}

function rowTop(key: string): number {
  return rowRect(key)?.top ?? Number.NaN;
}

type Visible = { key: string; top: number; bottom: number };

function visibleRows(): Visible[] {
  const sc = scroller();
  const base = sc.getBoundingClientRect().top;
  const h = sc.clientHeight;
  const out: Visible[] = [];
  for (const el of sc.querySelectorAll<HTMLElement>("[data-key]")) {
    if (el.dataset.sticky !== undefined) continue;
    const r = el.getBoundingClientRect();
    const top = r.top - base;
    const bottom = r.bottom - base;
    if (bottom > 0 && top < h) out.push({ key: el.dataset.key as string, top, bottom });
  }
  return out.sort((a, b) => a.top - b.top);
}

/** A message row fully in view whose top is at or below `fraction` of the viewport. */
function tryAnchor(fraction = 0.3, skip?: (key: string) => boolean): string | null {
  const h = scroller().clientHeight;
  const shown = visibleRows();
  const rows = shown.filter(
    (r) => !r.key.startsWith("d:") && r.top >= 0 && r.bottom <= h && !skip?.(r.key),
  );
  // A row taller than the viewport: any drawn row in view will do.
  const at = rows.find((r) => r.top >= fraction * h) ?? rows[0] ?? shown[0];
  return at?.key ?? null;
}

function pickAnchor(fraction = 0.3, skip?: (key: string) => boolean): string {
  const at = tryAnchor(fraction, skip);
  if (!at) throw new Error("no anchor row in view");
  return at;
}

function gapToEnd(): number {
  const sc = scroller();
  return sc.scrollHeight - sc.clientHeight - sc.scrollTop;
}

/** Wait until the scroll position, the content height and the drawn rows stop changing. */
async function settle(minFrames = 10, maxFrames = 150): Promise<number> {
  let stable = 0;
  let last = "";
  let i = 0;
  for (; i < maxFrames; i++) {
    await raf();
    const sc = scroller();
    const sig = `${sc.scrollTop}|${sc.scrollHeight}|${sc.querySelectorAll("[data-key]").length}`;
    if (sig === last) stable++;
    else {
      stable = 0;
      last = sig;
    }
    if (stable >= minFrames) break;
  }
  return i;
}

function clean(): Partial<HarnessState> {
  return {
    arrivals: [],
    folded: new Set(),
    edits: new Map(),
    density: "comfortable",
    edgeContext: true,
  };
}

/** Remount the stream with a new window; returns once the new stream has drawn and settled. */
async function remount(patch: Partial<HarnessState>): Promise<void> {
  const prev = control.api();
  control.set((s) => ({ ...clean(), ...patch, mount: s.mount + 1 }));
  probe.arm();
  for (let i = 0; i < 120 && (control.api() === prev || !control.api()); i++) await raf();
  await waitFrames(2);
  await settle();
}

/**
 * Scroll by `delta` now, as input would: a user's scroll reaches the page's
 * scroll listeners before the frame's layout and ResizeObserver callbacks, but
 * a scrollTop write in requestAnimationFrame fires its event only next frame,
 * so a library correcting the scroll in this frame would work from a stale
 * offset and undo the step. Dispatching the event here keeps the order real.
 * Returns the change actually applied.
 */
function scrollBy(delta: number): number {
  const sc = scroller();
  const before = sc.scrollTop;
  sc.scrollTop = before + delta;
  sc.dispatchEvent(new Event("scroll"));
  return sc.scrollTop - before;
}

function scrollToTop(top: number): void {
  scrollBy(top - scroller().scrollTop);
}

/**
 * Track a row while something happens: the largest and the final distance
 * from where it was, per painted frame.
 */
async function track(
  key: string,
  frames: number,
  act: (frame: number) => void,
): Promise<{ max: number; final: number; frames: number[] }> {
  const top0 = rowTop(key);
  const seen: number[] = [];
  await probe.run(
    { frames },
    {
      before: act,
      sample: () => {
        const t = rowTop(key);
        seen.push(Number.isNaN(t) ? Number.POSITIVE_INFINITY : round(t - top0));
        countElements();
      },
    },
  );
  await settle();
  const final = rowTop(key) - top0;
  return {
    max: round(Math.max(...seen.map(Math.abs), Math.abs(final))),
    final: round(final),
    frames: seen,
  };
}

/**
 * Scroll by `step` px a frame while `act` runs, and measure how far a row in
 * view moves beyond the scroll itself ("unexpected movement" = a jump).
 */
async function scrollAndWatch(
  frames: number,
  step: number,
  act?: (frame: number) => void,
): Promise<{ maxUnexpected: number; total: number; perFrame: number[] }> {
  let key: string | null = pickAnchor(0.45);
  let prev = rowTop(key);
  let applied = 0;
  const per: number[] = [];
  await probe.run(
    { frames },
    {
      before: (i) => {
        applied = scrollBy(step);
        act?.(i);
      },
      sample: () => {
        countElements();
        const t = key === null ? Number.NaN : rowTop(key);
        if (!Number.isNaN(t)) {
          per.push(round(t - prev + applied));
          prev = t;
        }
        // Re-pick when the row left the drawn range or nears an edge.
        const h = scroller().clientHeight;
        if (Number.isNaN(t) || t < 0.1 * h || t > 0.8 * h) {
          key = tryAnchor(0.45);
          prev = key === null ? Number.NaN : rowTop(key);
        }
      },
    },
  );
  const abs = per.map(Math.abs);
  return {
    maxUnexpected: round(Math.max(0, ...abs)),
    total: round(per.reduce((a, b) => a + b, 0)),
    perFrame: per.filter((v) => Math.abs(v) > 0.5),
  };
}

function result(
  scenario: string,
  bar: string,
  pass: boolean | null,
  metrics: Record<string, Value>,
  note?: string,
): Result {
  const s = control.state();
  return {
    scenario,
    lib: s.lib,
    config: s.config.id,
    bar,
    pass,
    metrics,
    ...(note ? { note } : {}),
  };
}

// ---------------------------------------------------------------- scenarios

async function openBottom(): Promise<Result[]> {
  const prev = control.api();
  const t0 = performance.now();
  control.set((s) => ({ ...clean(), ...NEWEST, initial: { kind: "end" }, mount: s.mount + 1 }));
  const commitMs = performance.now() - t0;
  probe.arm();
  for (let i = 0; i < 60 && (control.api() === prev || !control.api()); i++) await raf();
  const gaps: number[] = [];
  let firstFrameMs = -1;
  await probe.run(
    { frames: 30 },
    {
      sample: () => {
        if (firstFrameMs < 0) firstFrameMs = performance.now() - t0;
        gaps.push(round(gapToEnd()));
        countElements();
      },
    },
  );
  await settle();
  const final = gapToEnd();
  return [
    result(
      "open-bottom",
      "opens at the end (gap ≤ 1 px), no settling jitter",
      final <= 1 && Math.max(...gaps) <= 1,
      {
        commitMs: round(commitMs),
        firstPaintedFrameMs: round(firstFrameMs),
        finalGap: round(final),
        maxGapWhileSettling: round(Math.max(...gaps)),
        elements: countElements(),
      },
    ),
  ];
}

/** Rows a prepend adds (the keys the current rows don't have). */
function rowsAfterPrepend(n: number): { next: Row[]; added: Row[] } {
  const s = control.state();
  const before = new Set(
    windowRows(s.lo, s.hi, s.arrivals, s.folded, s.edits, s.edgeContext).map((r) => r.key),
  );
  const next = windowRows(
    Math.max(0, s.lo - n),
    s.hi,
    s.arrivals,
    s.folded,
    s.edits,
    s.edgeContext,
  );
  return { next, added: next.filter((r) => !before.has(r.key)) };
}

/** Draw rows off screen at the stream's width and density; their heights by key. */
function measureOffscreen(rows: readonly Row[]): Map<string, number> {
  const s = control.state();
  const host = document.createElement("div");
  host.className = "s1-scroller";
  host.dataset.density = s.density;
  if (s.config.contain) host.dataset.contain = "";
  host.dataset.imgbox = s.config.imageBox;
  host.style.position = "absolute";
  host.style.left = "-20000px";
  host.style.top = "0";
  host.style.height = "auto";
  host.style.visibility = "hidden";
  host.style.width = `${scroller().clientWidth}px`;
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() =>
    root.render(
      rows.map((r) => (
        <div key={r.key} className="s1-measure" data-measure={r.key}>
          <RowView row={r} />
        </div>
      )),
    ),
  );
  const sizes = new Map<string, number>();
  for (const el of host.querySelectorAll<HTMLElement>("[data-measure]")) {
    sizes.set(el.dataset.measure as string, el.offsetHeight);
  }
  root.unmount();
  host.remove();
  return sizes;
}

async function prepend(variant: "honest" | "seeded" | "naive"): Promise<Result[]> {
  if (variant === "seeded" && !api().seedSizes) return [];
  await remount({ ...NEWEST, initial: { kind: "end" }, edgeContext: variant !== "naive" });
  const per: Array<{ max: number; final: number }> = [];
  let firstBad: Record<string, number | string | number[]> | null = null;
  let seedMs = 0;
  for (let k = 0; k < 10; k++) {
    scrollToTop(0);
    await settle();
    const anchor = pickAnchor(0.3);
    if (variant === "seeded") {
      const t = performance.now();
      const { added } = rowsAfterPrepend(50);
      api().seedSizes?.(measureOffscreen(added));
      seedMs = Math.max(seedMs, performance.now() - t);
    }
    const r = await track(anchor, 16, (i) => {
      if (i === 0) control.set((s) => ({ lo: Math.max(0, s.lo - 50) }));
    });
    per.push({ max: r.max, final: r.final });
    if (r.max > 1 && !firstBad) {
      firstBad = {
        prepend: k,
        anchor,
        fonts: document.fonts.status,
        frames: r.frames.map((f) => (Number.isFinite(f) ? f : -9999)),
      };
    }
  }
  const max = Math.max(...per.map((p) => p.max));
  return [
    result(`prepend-${variant}`, "anchor row moves ≤ 1 px on each of 10 prepends of 50", max <= 1, {
      maxDrift: max,
      maxFinalDrift: Math.max(...per.map((p) => Math.abs(p.final))),
      perPrependMax: per.map((p) => p.max),
      ...(variant === "seeded" ? { offscreenMeasureMsMax: round(seedMs) } : {}),
      rowsAtEnd: control.state().hi - control.state().lo,
      ...(firstBad ? { firstBad } : {}),
    }),
  ];
}

async function fold(where: "mid" | "straddle" | "end"): Promise<Result[]> {
  if (where === "end") {
    await remount({ ...NEWEST, initial: { kind: "end" } });
    const rootId = id(SCENARIO_CHAINS.end);
    const lastKey = visibleRows().at(-1)?.key as string;
    const rootVisible = rowRect(rootId);
    const bottom0 = rowRect(lastKey)?.bottom ?? Number.NaN;
    const bottoms: number[] = [];
    await probe.run(
      { frames: 16 },
      {
        before: (i) => {
          if (i === 0) control.set({ folded: new Set([rootId]) });
        },
        sample: () => bottoms.push(round((rowRect(lastKey)?.bottom ?? Number.NaN) - bottom0)),
      },
    );
    await settle();
    const final = (rowRect(lastKey)?.bottom ?? Number.NaN) - bottom0;
    const max = Math.max(...bottoms.map(Math.abs), Math.abs(final));
    return [
      result(
        "fold-at-end",
        "a chain folding above the viewport while at the end: the last row stays put (≤ 1 px)",
        max <= 1,
        {
          maxDrift: round(max),
          finalDrift: round(final),
          finalGap: round(gapToEnd()),
          chainWasVisible: rootVisible !== null && rootVisible.bottom > 0,
        },
      ),
    ];
  }
  const rootSeq = SCENARIO_CHAINS.mid;
  const rootId = id(rootSeq);
  await remount({ lo: rootSeq - 150, hi: COUNT, initial: { kind: "key", key: rootId } });
  const sc = scroller();
  const h = sc.clientHeight;
  const replies = new Set<string>();
  for (let j = 1; j <= 6; j++) replies.add(id(rootSeq + j));
  if (where === "mid") {
    scrollBy(rowTop(rootId) - 0.4 * h);
    await settle();
    // The reader's row: the first fully visible message above the chain.
    const rootTop = rowTop(rootId);
    const above = visibleRows().filter(
      (r) => !r.key.startsWith("d:") && r.top >= 0 && r.bottom <= rootTop,
    );
    const anchor = above[0]?.key ?? pickAnchor(0);
    const folded = await track(anchor, 16, (i) => {
      if (i === 0) control.set({ folded: new Set([rootId]) });
    });
    const unfolded = await track(anchor, 16, (i) => {
      if (i === 0) control.set({ folded: new Set() });
    });
    const max = Math.max(folded.max, unfolded.max);
    return [
      result(
        "fold-mid",
        "a 6-reply chain folding mid-screen: the row above it moves ≤ 1 px (fold and unfold)",
        max <= 1,
        {
          foldMaxDrift: folded.max,
          unfoldMaxDrift: unfolded.max,
        },
      ),
    ];
  }
  // straddle: the 3rd reply sits at the viewport's top edge (the library's own
  // anchor is a row the fold removes).
  const third = id(rootSeq + 3);
  scrollBy(rowTop(third));
  await settle();
  const below = visibleRows().find(
    (r) => r.top >= 0 && !replies.has(r.key) && r.key !== rootId && !r.key.startsWith("d:"),
  );
  const belowKey = below?.key as string;
  const r = await track(belowKey, 16, (i) => {
    if (i === 0) control.set({ folded: new Set([rootId]) });
  });
  const chainRow = rowRect(`c:${rootId}`);
  return [
    result("fold-straddle", "informational (CV-12): a chain folding across the top edge", null, {
      rowBelowChainMoved: r.final,
      rowBelowChainMaxDuringFold: r.max,
      foldedChainRowTop: chainRow ? round(chainRow.top) : null,
    }),
  ];
}

/** A drawn message row entirely above the viewport (closest to it). */
function pickAbove(): string | null {
  const sc = scroller();
  const base = sc.getBoundingClientRect().top;
  let best: { key: string; bottom: number } | null = null;
  for (const el of sc.querySelectorAll<HTMLElement>("[data-key]")) {
    if (el.dataset.sticky !== undefined) continue;
    const key = el.dataset.key as string;
    if (key.startsWith("d:") || key.startsWith("c:")) continue;
    const bottom = el.getBoundingClientRect().bottom - base;
    if (bottom < -10 && (best === null || bottom > best.bottom)) best = { key, bottom };
  }
  return best?.key ?? null;
}

async function editAbove(scrolling: boolean): Promise<Result[]> {
  await remount({ lo: 9_000, hi: COUNT, initial: { kind: "key", key: id(9_500) } });
  // At rest means at rest: TanStack treats the 150 ms after the last scroll
  // event as still scrolling (and its direction as the last one's).
  if (!scrolling) await sleep(400);
  let edited: string | null = null;
  const editFrame = scrolling ? 15 : 2;
  const watch = await scrollAndWatch(scrolling ? 50 : 20, scrolling ? -6 : 0, (i) => {
    if (i !== editFrame) return;
    edited = pickAbove();
    const key = edited;
    if (key) control.set((s) => ({ edits: new Map(s.edits).set(key, editGrowth()) }));
  });
  await settle();
  const name = scrolling ? "edit-above-scrolling-up" : "edit-above-at-rest";
  return [
    result(
      name,
      "a row above the viewport grows by ~3 lines: the rows in view move ≤ 1 px beyond the scroll",
      edited === null ? null : watch.maxUnexpected <= 1,
      {
        maxUnexpected: watch.maxUnexpected,
        total: watch.total,
        jumps: watch.perFrame,
        edited: edited ?? "none drawn above the viewport",
      },
    ),
  ];
}

async function arriveHistory(): Promise<Result[]> {
  await remount({ lo: 9_500, hi: COUNT, initial: { kind: "key", key: id(9_700) } });
  const anchor = pickAnchor(0.3);
  const gap0 = gapToEnd();
  const r = await track(anchor, 20, (i) => {
    if (i === 0 || i === 8)
      control.set((s) => ({ arrivals: [...s.arrivals, arrival(i ? "short" : "long")] }));
  });
  return [
    result(
      "arrive-reading-history",
      "a message arrives while reading history: no pull (anchor ≤ 1 px)",
      r.max <= 1,
      {
        maxDrift: r.max,
        finalDrift: r.final,
        gapBefore: round(gap0),
        gapAfter: round(gapToEnd()),
      },
    ),
  ];
}

async function arriveEnd(offset: number): Promise<Result[]> {
  await remount({ ...NEWEST, initial: { kind: "end" } });
  if (offset) {
    scrollBy(-offset);
    await settle();
  }
  const gap0 = gapToEnd();
  const anchor = pickAnchor(0.3);
  const top0 = rowTop(anchor);
  const msg = arrival("long");
  const gaps: number[] = [];
  await probe.run(
    { frames: 30 },
    {
      before: (i) => {
        if (i === 0) control.set((s) => ({ arrivals: [...s.arrivals, msg] }));
      },
      sample: () => gaps.push(round(gapToEnd())),
    },
  );
  await settle();
  const finalGap = gapToEnd();
  const row = rowRect(msg.id);
  const h = scroller().clientHeight;
  const visible = row !== null && row.top >= -1 && row.bottom <= h + 1;
  const follows = offset <= 80;
  const drift = rowTop(anchor) - top0;
  const pass = follows ? finalGap <= 1 && visible : Math.abs(drift) <= 1 && !visible;
  return [
    result(
      `arrive-at-end-${offset}`,
      follows
        ? "at the end (within 80 px): follows, the new row fully in view"
        : "120 px up: no follow, anchor ≤ 1 px",
      pass,
      {
        gapBefore: round(gap0),
        finalGap: round(finalGap),
        newRowFullyVisible: visible,
        anchorDrift: round(drift),
        framesToEnd: gaps.findIndex((g) => g <= 1),
      },
    ),
  ];
}

async function arriveMomentum(): Promise<Result[]> {
  await remount({ ...NEWEST, initial: { kind: "end" } });
  // Upward flick, then a downward fling that reaches the end and keeps
  // pushing (as momentum does) while three messages arrive.
  scrollBy(-1200);
  await settle();
  const sent: Msg[] = [];
  let t0 = -1;
  const at = [700, 1100, 1500];
  await probe.run(
    { ms: 2200 },
    {
      before: (_i, t) => {
        if (t0 < 0) t0 = t;
        const e = (t - t0) / 1000;
        scrollBy(Math.max(2, 60 * Math.exp(-e / 0.9)));
        const due = at.filter((ms) => t - t0 >= ms).length;
        while (sent.length < due) {
          const m = arrival(sent.length === 1 ? "long" : "short");
          sent.push(m);
          control.set((s) => ({ arrivals: [...s.arrivals, m] }));
        }
      },
      sample: () => countElements(),
    },
  );
  await settle();
  const last = sent.at(-1) as Msg;
  const row = rowRect(last.id);
  const h = scroller().clientHeight;
  const visible = row !== null && row.bottom <= h + 1;
  return [
    result(
      "arrive-during-momentum",
      "messages arriving while a fling reaches the end: follows (synthetic momentum)",
      gapToEnd() <= 1 && visible,
      {
        finalGap: round(gapToEnd()),
        lastRowFullyVisible: visible,
      },
    ),
  ];
}

function centreError(key: string): number {
  const r = rowRect(key);
  if (!r) return Number.POSITIVE_INFINITY;
  const h = scroller().clientHeight;
  return Math.abs((r.top + r.bottom) / 2 - h / 2);
}

async function jumpWindowed(): Promise<Result[]> {
  await remount({ ...NEWEST, initial: { kind: "end" } });
  const target = id(5_000);
  const prev = control.api();
  const t0 = performance.now();
  control.set((s) => ({
    ...clean(),
    lo: 4_900,
    hi: 5_100,
    initial: { kind: "key", key: target },
    mount: s.mount + 1,
  }));
  probe.arm();
  for (let i = 0; i < 60 && (control.api() === prev || !control.api()); i++) await raf();
  let landedMs = -1;
  const errs: number[] = [];
  await probe.run(
    { frames: 40 },
    {
      sample: () => {
        const e = centreError(target);
        errs.push(round(e));
        if (landedMs < 0 && e <= 1) landedMs = performance.now() - t0;
        countElements();
      },
    },
  );
  await settle();
  const landed = centreError(target);
  // And back to the present.
  const prev2 = control.api();
  const t1 = performance.now();
  control.set((s) => ({ ...clean(), ...NEWEST, initial: { kind: "end" }, mount: s.mount + 1 }));
  probe.arm();
  for (let i = 0; i < 60 && (control.api() === prev2 || !control.api()); i++) await raf();
  let backMs = -1;
  await probe.run(
    { frames: 30 },
    {
      sample: () => {
        if (backMs < 0 && gapToEnd() <= 1) backMs = performance.now() - t1;
      },
    },
  );
  await settle();
  const backGap = gapToEnd();
  return [
    result(
      "jump-5000-windowed",
      "jump to row 5,000 (a window around it) lands within 1 px; back to the present at the end",
      landed <= 1 && backGap <= 1,
      {
        landingError: round(landed),
        landedMs: round(landedMs),
        maxErrorAfterFirstDraw: round(Math.max(...errs.filter(Number.isFinite), 0)),
        backGap: round(backGap),
        backMs: round(backMs),
      },
    ),
  ];
}

async function jumpFull(): Promise<Result[]> {
  await remount({ lo: 0, hi: COUNT, initial: { kind: "end" } });
  const target = id(5_000);
  const t0 = performance.now();
  api().scrollToKey(target, "center");
  let landedMs = -1;
  await probe.run(
    { frames: 90 },
    {
      sample: () => {
        if (landedMs < 0 && centreError(target) <= 1) landedMs = performance.now() - t0;
      },
    },
  );
  await settle();
  const first = centreError(target);
  let second: number | null = null;
  if (first > 1) {
    api().scrollToKey(target, "center");
    await settle();
    second = centreError(target);
  }
  api().scrollToEnd();
  await waitFrames(30);
  await settle();
  const backGap = gapToEnd();
  return [
    result(
      "jump-5000-all-rows",
      "all 10,000 rows in the list: scrollToIndex lands within 1 px",
      first <= 1 || (second ?? 99) <= 1,
      {
        landingError: round(first),
        secondTryError: second === null ? null : round(second),
        landedMs: round(landedMs),
        backGap: round(backGap),
      },
    ),
  ];
}

/** The day header stuck at the top shows the day of the message under it. */
function stickyState(): "ok" | "wrong" | "missing" | "n/a" {
  const sc = scroller();
  const box = sc.getBoundingClientRect();
  let stuck: HTMLElement | null = null;
  for (const el of sc.querySelectorAll<HTMLElement>(".s1-day")) {
    if (Math.abs(el.getBoundingClientRect().top - box.top) <= 1) {
      stuck = el;
      break;
    }
  }
  const y = box.top + (stuck ? stuck.getBoundingClientRect().height : 0) + 2;
  const under = document.elementFromPoint(box.left + 80, y)?.closest<HTMLElement>(".s1-msg");
  if (!under) return "n/a";
  if (!stuck) return "missing";
  return stuck.dataset.day === under.dataset.day ? "ok" : "wrong";
}

async function fling(): Promise<Result[]> {
  await remount({ lo: 0, hi: COUNT, initial: { kind: "end" } });
  const out: Result[] = [];
  const sticky = { ok: 0, wrong: 0, missing: 0, "n/a": 0 };
  let badRun = 0;
  let maxBadRun = 0;
  for (const dir of [-1, 1] as const) {
    let t0 = -1;
    let lastT = -1;
    let applied = 0;
    let key: string | null = pickAnchor(0.45);
    let prev = rowTop(key);
    let blank = 0;
    const jumps: number[] = [];
    const deltas: number[] = [];
    const {
      result: times,
      loaf,
      longtasks,
      supported,
    } = await longFrames(() =>
      probe.run(
        { ms: 2000 },
        {
          before: (_i, t) => {
            if (t0 < 0) t0 = t;
            const dt = lastT < 0 ? 16.7 : t - lastT;
            lastT = t;
            const v = 9000 * Math.exp(-(t - t0) / 1000 / 0.5);
            applied = scrollBy(dir * v * (dt / 1000));
          },
          sample: () => {
            countElements();
            const st = stickyState();
            sticky[st]++;
            badRun = st === "wrong" || st === "missing" ? badRun + 1 : 0;
            maxBadRun = Math.max(maxBadRun, badRun);
            if (visibleRows().length === 0) blank++;
            const top = key === null ? Number.NaN : rowTop(key);
            if (!Number.isNaN(top)) {
              jumps.push(Math.abs(top - prev + applied));
              prev = top;
            }
            const h = scroller().clientHeight;
            if (Number.isNaN(top) || top < 0.1 * h || top > 0.85 * h) {
              key = tryAnchor(0.45);
              prev = key === null ? Number.NaN : rowTop(key);
            }
          },
        },
      ),
    );
    for (let i = 1; i < times.length; i++)
      deltas.push((times[i] as number) - (times[i - 1] as number));
    const s = stats(deltas);
    const over50 = deltas.filter((d) => d > 50).length;
    const loafOver50 = loaf.filter((d) => d > 50);
    out.push(
      result(
        `fling-${dir < 0 ? "up" : "down"}`,
        "2 s fling over 10,000 rows: no frame over 50 ms; rows in view don't jump",
        over50 === 0 && loafOver50.length === 0,
        {
          frames: times.length,
          fps: round(times.length / 2),
          frameMs: s,
          framesOver50: over50,
          loafOver50: loafOver50.map((d) => round(d)),
          longtasks: longtasks.length,
          entryTypes: supported.join(",") || "none",
          maxJumpPx: round(Math.max(0, ...jumps)),
          jumpsOver1: jumps.filter((j) => j > 1).length,
          blankFrames: blank,
        },
      ),
    );
    await settle();
  }
  out.push(
    result(
      "sticky-day-header",
      "the stuck day header names the day under it, every fling frame",
      sticky.wrong === 0 && sticky.missing === 0,
      {
        ...sticky,
        longestWrongRunFrames: maxBadRun,
      },
    ),
  );
  // Through every row, 0.8 of a screen a frame, for the element count.
  scrollToTop(scroller().scrollHeight);
  await settle();
  const deltas: number[] = [];
  let lastT = -1;
  let frames = 0;
  let blankThrough = 0;
  await probe.run(
    { frames: 3000, stop: () => scroller().scrollTop <= 0 },
    {
      before: (_i, t) => {
        if (lastT >= 0) deltas.push(t - lastT);
        lastT = t;
        frames++;
        scrollBy(-0.8 * scroller().clientHeight);
      },
      sample: () => {
        countElements();
        if (visibleRows().length === 0) blankThrough++;
      },
    },
  );
  out.push(
    result("scroll-through-all", "≤ 3,000 elements in the stream at any point", null, {
      frames,
      reachedTop: scroller().scrollTop <= 1,
      frameMs: stats(deltas),
      blankFrames: blankThrough,
    }),
  );
  api().scrollToEnd();
  await settle();
  return out;
}

async function densitySwitch(mode: "default" | "anchored"): Promise<Result[]> {
  if (mode === "anchored" && !api().setDensityAnchored) return [];
  await remount({ lo: 9_000, hi: COUNT, initial: { kind: "key", key: id(9_500) } });
  // Measure ~2,500 px of rows above first, so they hold this density's sizes.
  const start = scroller().scrollTop;
  for (let i = 0; i < 20; i++) {
    scrollBy(-125);
    await raf();
  }
  await settle();
  scrollToTop(start);
  await settle();
  const drifts: Record<string, number> = {};
  const firstFrames: Record<string, number> = {};
  const sw = async (d: Density) => {
    const anchor = pickAnchor(0);
    const r = await track(anchor, 16, (i) => {
      if (i !== 0) return;
      if (mode === "anchored") api().setDensityAnchored?.(d);
      control.set({ density: d });
    });
    drifts[d] = Number.isFinite(r.max) ? r.max : -1;
    firstFrames[d] = r.frames.findIndex((f) => !Number.isFinite(f));
  };
  await sw("dense");
  // Scroll up through rows measured at the old density.
  const up = await scrollAndWatch(60, -12);
  await settle();
  await sw("compact");
  await sw("comfortable");
  const maxDrift = Object.values(drifts).some((v) => v < 0)
    ? Number.POSITIVE_INFINITY
    : Math.max(...Object.values(drifts));
  return [
    result(
      `density-${mode}`,
      "density switch: anchor ≤ 1 px; then scrolling up through rows measured at the old density: ≤ 1 px",
      maxDrift <= 1 && up.maxUnexpected <= 1,
      {
        driftBySwitch: drifts,
        anchorMissingAtFrame: firstFrames,
        scrollUpMaxUnexpected: up.maxUnexpected,
        scrollUpJumps: up.perFrame,
      },
    ),
  ];
}

async function images(): Promise<Result[]> {
  // All 10,000 rows, from the end up through ~230 rows (about a dozen images).
  await remount({ lo: 0, hi: COUNT, initial: { kind: "end" } });
  const sizes = new Map<Element, number>();
  let changes = 0;
  const deltas: number[] = [];
  const ro = new ResizeObserver((entries) => {
    for (const e of entries) {
      // A row scrolled out of the drawn range reports 0 as it leaves.
      if (!e.target.isConnected) {
        ro.unobserve(e.target);
        continue;
      }
      const h = e.contentRect.height;
      const prev = sizes.get(e.target);
      if (prev !== undefined && Math.abs(prev - h) > 0.01) {
        changes++;
        deltas.push(round(h - prev));
      }
      sizes.set(e.target, h);
    }
  });
  const observeAll = () => {
    for (const el of scroller().querySelectorAll(".s1-image")) if (!sizes.has(el)) ro.observe(el);
  };
  const mo = new MutationObserver(observeAll);
  mo.observe(scroller(), { childList: true, subtree: true });
  observeAll();
  const watch = await scrollAndWatch(600, -30);
  await sleep(400);
  await settle();
  mo.disconnect();
  ro.disconnect();
  return [
    result(
      "image-rows-reserved",
      "image rows keep their reserved box when the preview decodes; rows in view don't move",
      changes === 0 && watch.maxUnexpected <= 1,
      {
        imageBoxes: sizes.size,
        boxSizeChanges: changes,
        boxSizeDeltas: deltas,
        maxUnexpected: watch.maxUnexpected,
        jumps: watch.perFrame,
      },
    ),
  ];
}

/** Which harness modules the React Compiler compiled (dev bundle text). */
async function compilerCheck(): Promise<Result[]> {
  const urls = new Set<string>();
  for (const s of document.querySelectorAll<HTMLScriptElement>("script[src]")) urls.add(s.src);
  for (const e of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
    if (e.initiatorType === "script" || e.name.endsWith(".js")) urls.add(e.name);
  }
  let text = "";
  for (const url of urls) {
    try {
      text += await (await fetch(url)).text();
    } catch {
      // not ours
    }
  }
  // Dev bundles define each module as `"./path"(module, …) {`; a compiled
  // component starts with `const $ = (0, …compiler_runtime….c)(n)`.
  const moduleBody = (file: string): string | null => {
    const at = text.indexOf(`s1/harness/${file}"(module`);
    if (at < 0) return null;
    const next = text.indexOf('\n"./', at + 10);
    return text.slice(at, next < 0 ? undefined : next);
  };
  const components = (file: string) => {
    const body = moduleBody(file);
    if (body === null) return null;
    const all = [...body.matchAll(/\nfunction ([A-Z]\w*)\(/g)].map((m) => m[1] as string);
    const done = [
      ...body.matchAll(
        /\nfunction ([A-Z]\w*)\([^)]*\)\s*\{[^\n]*\n\s*(?:_s\(\);\s*)?const \$ = \(0,\s*react_compiler_runtime/g,
      ),
    ].map((m) => m[1] as string);
    return { compiled: done, notCompiled: all.filter((n) => !done.includes(n)) };
  };
  const files = ["rows.tsx", "app.tsx", "tanstack-stream.tsx", "legend-stream.tsx"];
  const metrics: Record<string, Value> = {};
  for (const f of files) {
    const c = components(f);
    metrics[f] =
      c === null
        ? "not in the bundle"
        : `compiled: ${c.compiled.join(" ") || "none"} · not compiled: ${c.notCompiled.join(" ") || "none"}`;
  }
  const rows = components("rows.tsx");
  const stream = components("tanstack-stream.tsx");
  const pass =
    rows !== null &&
    rows.notCompiled.length === 0 &&
    stream !== null &&
    stream.compiled.length === 0;
  return [result("compiler", "rows compiled; only the stream file opts out", pass, metrics)];
}

// ---------------------------------------------------------------- the plan

type Scenario = { name: string; run: () => Promise<Result[]> };

const ALL: Scenario[] = [
  { name: "open", run: openBottom },
  { name: "prepend", run: () => prepend("honest") },
  { name: "prepend-seeded", run: () => prepend("seeded") },
  { name: "prepend-naive", run: () => prepend("naive") },
  { name: "fold-mid", run: () => fold("mid") },
  { name: "fold-straddle", run: () => fold("straddle") },
  { name: "fold-end", run: () => fold("end") },
  { name: "edit-rest", run: () => editAbove(false) },
  { name: "edit-up", run: () => editAbove(true) },
  { name: "arrive-history", run: arriveHistory },
  { name: "arrive-end", run: () => arriveEnd(0) },
  { name: "arrive-end-50", run: () => arriveEnd(50) },
  { name: "arrive-end-120", run: () => arriveEnd(120) },
  { name: "arrive-momentum", run: arriveMomentum },
  { name: "jump", run: jumpWindowed },
  { name: "jump-full", run: jumpFull },
  { name: "density", run: () => densitySwitch("default") },
  { name: "density-anchored", run: () => densitySwitch("anchored") },
  { name: "images", run: images },
  { name: "fling", run: fling },
  { name: "compiler", run: compilerCheck },
];

const ANCHORING = [
  "prepend",
  "prepend-seeded",
  "fold-mid",
  "fold-end",
  "edit-rest",
  "edit-up",
  "arrive-history",
  "arrive-end",
  "density",
  "density-anchored",
];

export const TANSTACK_CONFIGS: Array<{ config: StreamConfig; scenarios: string[] }> = [
  // TanStack's defaults with VirtualStack's useFlushSync: false (the baseline).
  { config: BASE_CONFIG, scenarios: ALL.map((s) => s.name) },
  {
    config: { ...BASE_CONFIG, id: "flushSync", useFlushSync: true },
    scenarios: [...ANCHORING, "fling"],
  },
  {
    config: { ...BASE_CONFIG, id: "adjustAbove", adjust: "above" },
    scenarios: ["edit-rest", "edit-up", "density", "fling"],
  },
  { config: RECOMMENDED, scenarios: ALL.map((s) => s.name) },
  {
    config: { ...RECOMMENDED, id: "recommended-overflowAnchorAuto", overflowAnchor: "auto" },
    scenarios: [
      "prepend",
      "fold-mid",
      "edit-rest",
      "edit-up",
      "arrive-history",
      "density-anchored",
    ],
  },
  {
    config: { ...RECOMMENDED, id: "recommended-noContain", contain: false },
    scenarios: ["prepend", "density-anchored", "fling"],
  },
  {
    config: { ...RECOMMENDED, id: "recommended-directDom", directDom: true },
    scenarios: ["prepend", "edit-up", "fling"],
  },
  {
    config: { ...RECOMMENDED, id: "recommended-imgAttrs", imageBox: "attrs" },
    scenarios: ["images"],
  },
];

export type RunOptions = {
  engine: string;
  libs: string[];
  only: string[] | null;
  /** Run each selected scenario this many times (flake hunting). */
  repeat: number;
  configs: string[] | null;
  collect: string | null;
};

export function fingerprint(engine: string): Record<string, Value> {
  const nav = navigator as Navigator & {
    userAgentData?: { brands?: Array<{ brand: string; version: string }> };
  };
  return {
    engine,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    devicePixelRatio: window.devicePixelRatio,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    overflowAnchorSupported: CSS.supports("overflow-anchor", "none"),
    scrollendEvent: "onscrollend" in window,
    entryTypes: (PerformanceObserver.supportedEntryTypes ?? []).join(","),
    tauri: "__TAURI_INTERNALS__" in window,
    brands: (nav.userAgentData?.brands ?? []).map((b) => `${b.brand} ${b.version}`).join(", "),
    build: process.env.NODE_ENV ?? "unknown",
  };
}

let progressUrl: string | null = null;
let progressEngine = "";

function status(text: string) {
  control.set({ status: text });
  if (progressUrl) {
    void fetch(progressUrl, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({
        progress: `${text}${document.hidden ? " (page hidden)" : ""}`,
        engine: progressEngine,
      }),
    }).catch(() => undefined);
  }
}

export async function run(opts: RunOptions): Promise<Record<string, Result[]>> {
  const all: Record<string, Result[]> = {};
  progressUrl = opts.collect;
  progressEngine = opts.engine;
  for (const lib of opts.libs) {
    if (!STREAMS[lib]) {
      all[lib] = [];
      continue;
    }
    maxElements = 0;
    const results: Result[] = [];
    const plans =
      lib === "tanstack"
        ? TANSTACK_CONFIGS
        : [{ config: BASE_CONFIG, scenarios: ALL.map((s) => s.name) }];
    for (const plan of plans) {
      if (opts.configs && !opts.configs.includes(plan.config.id)) continue;
      control.set((s) => ({ lib, config: plan.config, mount: s.mount + 1 }));
      await control.waitApi();
      await settle();
      for (const sc of ALL) {
        if (!plan.scenarios.includes(sc.name)) continue;
        if (opts.only && !opts.only.includes(sc.name)) continue;
        if (lib !== "tanstack" && (sc.name === "prepend-seeded" || sc.name === "density-anchored"))
          continue;
        for (let rep = 0; rep < opts.repeat; rep++) {
          currentScenario = `${plan.config.id}/${sc.name}`;
          status(`running ${lib} ${currentScenario}${opts.repeat > 1 ? ` #${rep + 1}` : ""}`);
          try {
            results.push(
              ...(await Promise.race([
                sc.run(),
                sleep(180_000).then(() => {
                  throw new Error("timed out after 180 s");
                }),
              ])),
            );
          } catch (e) {
            results.push({
              scenario: sc.name,
              lib,
              config: plan.config.id,
              bar: "",
              pass: false,
              metrics: {},
              note: `error: ${e instanceof Error ? e.message : String(e)}`,
            });
          }
        }
      }
    }
    results.push({
      scenario: "max-elements",
      lib,
      config: "all",
      bar: "≤ 3,000 elements in the stream",
      pass: maxElements <= 3_000,
      metrics: { maxElements, where: maxElementsWhere },
    });
    all[lib] = results;
    if (opts.collect) {
      await fetch(opts.collect, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({
          engine: opts.engine,
          lib,
          fingerprint: fingerprint(opts.engine),
          results,
        }),
      }).catch(() => undefined);
    }
  }
  status("done");
  (window as unknown as { __s1Done: unknown }).__s1Done = all;
  return all;
}
