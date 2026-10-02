// The bounded-grid engine — the risk core of the dashboard rebuild (DB-1).
//
// Pure, immutable, deterministic. Zero React/DOM/framer-motion imports so it can
// be exhaustively unit-tested and reused from anywhere. Everything here operates
// on plain `WidgetInstance[]` and returns NEW arrays and NEW widget objects, each
// with a freshly shallow-copied `config` — inputs are never mutated (the "a
// rejected drop leaves the layout byte-identical" contract, AC3, depends on this).
// `config` values are opaque JSON the engine never reads or writes; the shallow
// copy severs the top-level reference (deeply-nested config the app still edits
// immutably — replace, never mutate in place).
//
// The model is iOS/iPadOS home-screen physics on a fixed 8×4 that never scrolls:
//   • widgets exist only at S/M/L/XL preset spans (AC2);
//   • dragging pushes neighbours out of the way and gaps auto-close up-then-left;
//   • nothing can ever be placed or pushed outside the bounds — a drop that can't
//     be resolved is REJECTED (returns null → the UI snaps back). Never wrap.
//
// Completeness note: `resolveDrag` uses greedy nearest-free relocation for
// displaced widgets, not an exhaustive packer. It never produces an invalid
// layout, always terminates, and rejects conservatively — on a nearly-full grid
// it may reject a drop that a global rearrangement could technically fit. That is
// acceptable-by-design (reject == snap-back); correctness/termination/no-overlap
// are the guarantees, not maximal packing.

import type { DashboardLayout, DashboardPage, Rect, WidgetInstance, WidgetSize } from "./types";
import { GRID_COLS, GRID_ROWS, SIZE_SPANS, WIDGET_TYPES } from "./types";

// ── Primitives ──────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** A fresh widget object with a freshly shallow-copied config — the output unit. */
function cloneWidget(w: WidgetInstance): WidgetInstance {
  return { ...w, config: { ...w.config } };
}

/** Cell span for a size preset. */
export function spanOf(size: WidgetSize): { w: number; h: number } {
  return SIZE_SPANS[size];
}

/** The grid rectangle a placed widget occupies. */
export function rectOf(widget: WidgetInstance): Rect {
  const { w, h } = spanOf(widget.size);
  return { x: widget.x, y: widget.y, w, h };
}

/** True when the rect sits fully inside the 8×4 grid. */
export function inBounds(r: Rect): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= GRID_COLS && r.y + r.h <= GRID_ROWS;
}

/** Axis-aligned overlap test (touching edges do NOT overlap). */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Can `rect` be placed given `occupants`, ignoring the widgets in `ignoreIds`? */
export function canPlace(
  occupants: readonly WidgetInstance[],
  rect: Rect,
  ignoreIds: ReadonlySet<string> = EMPTY_SET,
): boolean {
  if (!inBounds(rect)) return false;
  for (const w of occupants) {
    if (ignoreIds.has(w.id)) continue;
    if (overlaps(rect, rectOf(w))) return false;
  }
  return true;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/** Reading-order comparator: top-to-bottom, then left-to-right, id as a stable tiebreak. */
function byReadingOrder(a: WidgetInstance, b: WidgetInstance): number {
  return a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

// ── Placement queries ───────────────────────────────────────────────────────

/**
 * First free slot for a span, scanning in reading order (row-major). Returns the
 * top-left cell, or null when nothing fits. `ignoreIds` lets a widget ignore its
 * own current footprint when searching (used by resize).
 */
export function findFirstFit(
  widgets: readonly WidgetInstance[],
  span: { w: number; h: number },
  ignoreIds: ReadonlySet<string> = EMPTY_SET,
): { x: number; y: number } | null {
  for (let y = 0; y <= GRID_ROWS - span.h; y++) {
    for (let x = 0; x <= GRID_COLS - span.w; x++) {
      if (canPlace(widgets, { x, y, w: span.w, h: span.h }, ignoreIds)) {
        return { x, y };
      }
    }
  }
  return null;
}

// ── Compaction ──────────────────────────────────────────────────────────────

/**
 * Gravity: slide every widget as far up as it can go, then as far left, repeated
 * to a fixpoint so gaps close (AC3). Deterministic (reading-order sweep) and
 * idempotent — `compact(compact(x))` deep-equals `compact(x)`. Output preserves
 * the input array's order; only x/y change. Widgets in `pinnedIds` never move
 * (used to hold the actively-dragged widget under the cursor during a preview).
 */
export function compact(
  widgets: readonly WidgetInstance[],
  pinnedIds: ReadonlySet<string> = EMPTY_SET,
): WidgetInstance[] {
  let current: WidgetInstance[] = widgets.map(cloneWidget);
  // Each move strictly lowers a widget's (y*COLS + x), so the process converges;
  // the cap is a defensive backstop far above any real convergence bound.
  const cap = GRID_COLS * GRID_ROWS * current.length + 1;

  for (let pass = 0; pass < cap; pass++) {
    let moved = false;
    const order = [...current].sort(byReadingOrder);
    for (const w of order) {
      if (pinnedIds.has(w.id)) continue;
      const span = spanOf(w.size);
      const others = current.filter((o) => o.id !== w.id);
      let nx = w.x;
      let ny = w.y;
      while (ny > 0 && canPlace(others, { x: nx, y: ny - 1, w: span.w, h: span.h })) ny--;
      while (nx > 0 && canPlace(others, { x: nx - 1, y: ny, w: span.w, h: span.h })) nx--;
      if (nx !== w.x || ny !== w.y) {
        current = current.map((o) => (o.id === w.id ? { ...o, x: nx, y: ny } : o));
        moved = true;
      }
    }
    if (!moved) break;
  }
  return current;
}

// ── Drag resolution (the crux) ──────────────────────────────────────────────

/** Fits `rect` against a set of already-settled rects (bounds + no overlap). */
function fitsAgainst(rect: Rect, settled: ReadonlyMap<string, Rect>): boolean {
  if (!inBounds(rect)) return false;
  for (const r of settled.values()) {
    if (overlaps(rect, r)) return false;
  }
  return true;
}

/**
 * Place one displaced widget: keep its start position if still free, else slide
 * it to the nearest free slot (Manhattan distance, reading-order tiebreak) so it
 * "gets out of the way" of the settled set. Null when nothing fits.
 */
function placeNearest(
  start: Rect,
  span: { w: number; h: number },
  settled: ReadonlyMap<string, Rect>,
): Rect | null {
  if (fitsAgainst(start, settled)) return start;

  let best: Rect | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let y = 0; y <= GRID_ROWS - span.h; y++) {
    for (let x = 0; x <= GRID_COLS - span.w; x++) {
      const candidate: Rect = { x, y, w: span.w, h: span.h };
      if (!fitsAgainst(candidate, settled)) continue;
      // Distance first, then reading order — a stable, deterministic pick.
      const score = (Math.abs(x - start.x) + Math.abs(y - start.y)) * 100 + y * GRID_COLS + x;
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
  }
  return best;
}

/**
 * Resolve a drag of `activeId` to `target` (top-left cell). The active widget is
 * pinned at the clamped target; every other widget keeps its spot if free, or is
 * relocated to its nearest free slot. Result is then compacted with active still
 * pinned (so the drop target doesn't drift under the cursor during a live preview).
 *
 * Returns a full new placement, or **null** when some widget can't be placed —
 * the caller treats null as "reject", keeping the previous layout untouched.
 */
export function resolveDrag(
  widgets: readonly WidgetInstance[],
  activeId: string,
  target: { x: number; y: number },
): WidgetInstance[] | null {
  const active = widgets.find((w) => w.id === activeId);
  if (!active) return null;

  const aSpan = spanOf(active.size);
  const aRect: Rect = {
    x: clamp(Math.round(target.x), 0, GRID_COLS - aSpan.w),
    y: clamp(Math.round(target.y), 0, GRID_ROWS - aSpan.h),
    w: aSpan.w,
    h: aSpan.h,
  };

  const settled = new Map<string, Rect>();
  settled.set(activeId, aRect);

  // Place the rest in reading order of their ORIGINAL positions, preferring their
  // own spot and only relocating those the active widget (or an earlier
  // relocation) displaced. One placement per widget → guaranteed termination.
  const rest = widgets.filter((w) => w.id !== activeId).sort(byReadingOrder);
  for (const w of rest) {
    const span = spanOf(w.size);
    const placed = placeNearest({ x: w.x, y: w.y, w: span.w, h: span.h }, span, settled);
    if (!placed) return null; // no room for everyone → reject the whole drag
    settled.set(w.id, placed);
  }

  const resolved = widgets.map((w) => {
    const r = settled.get(w.id) as Rect;
    return { ...w, x: r.x, y: r.y };
  });
  return compact(resolved, new Set([activeId]));
}

// ── Mutations ───────────────────────────────────────────────────────────────

/**
 * Add a widget at the first free slot for its size. Returns the extended,
 * compact layout, or null when the grid is full (the gallery then offers a new
 * page). The instance's incoming x/y are ignored — placement is chosen.
 */
export function addWidget(
  widgets: readonly WidgetInstance[],
  instance: WidgetInstance,
): WidgetInstance[] | null {
  const pos = findFirstFit(widgets, spanOf(instance.size));
  if (!pos) return null;
  return [...widgets.map(cloneWidget), cloneWidget({ ...instance, x: pos.x, y: pos.y })];
}

/** Remove a widget and close the gap it left (full compaction). Never fails. */
export function removeWidget(widgets: readonly WidgetInstance[], id: string): WidgetInstance[] {
  return compact(widgets.filter((w) => w.id !== id));
}

/**
 * Change a widget's size in place. The bigger/smaller footprint is anchored at
 * the widget's current (clamped) position and neighbours are pushed via the same
 * resolver. Returns null when it can't fit — the caller keeps the old size.
 */
export function resizeWidget(
  widgets: readonly WidgetInstance[],
  id: string,
  newSize: WidgetSize,
): WidgetInstance[] | null {
  const target = widgets.find((w) => w.id === id);
  if (!target) return null;
  if (target.size === newSize) return widgets.map(cloneWidget);

  const span = spanOf(newSize);
  const resized = widgets.map((w) => (w.id === id ? { ...w, size: newSize } : w));
  const anchor = {
    x: clamp(target.x, 0, GRID_COLS - span.w),
    y: clamp(target.y, 0, GRID_ROWS - span.h),
  };
  return resolveDrag(resized, id, anchor);
}

/** Commit a previewed layout: full gravity so nothing floats after a drop. */
export function commitLayout(widgets: readonly WidgetInstance[]): WidgetInstance[] {
  return compact(widgets);
}

// ── Page-level ops (DB-4) ────────────────────────────────────────────────────
//
// A layout is one-or-more pages; these are the pure, immutable page mutations the
// pager/edit-mode wire to. Widget geometry stays per-page; nothing here touches
// the grid math above.

/** Append a fresh empty page. The caller supplies a unique id (a uuid at the app layer). */
export function addPage(layout: DashboardLayout, newPageId: string): DashboardLayout {
  return { version: 1, pages: [...layout.pages, { id: newPageId, widgets: [] }] };
}

/**
 * Remove a page. No-op when it's the last one — a dashboard always keeps ≥1 page
 * (AC5, the "can't delete the last page away" edge case) — and no-op when the id
 * isn't present, so callers never have to guard.
 */
export function removePage(layout: DashboardLayout, pageId: string): DashboardLayout {
  if (layout.pages.length <= 1) return layout;
  const pages = layout.pages.filter((p) => p.id !== pageId);
  if (pages.length === layout.pages.length) return layout;
  return { version: 1, pages };
}

/** Replace one page's widgets (the drag/resize/remove commit target). New layout, no mutation. */
export function setPageWidgets(
  layout: DashboardLayout,
  pageId: string,
  widgets: WidgetInstance[],
): DashboardLayout {
  return {
    version: 1,
    pages: layout.pages.map((p) => (p.id === pageId ? { ...p, widgets } : p)),
  };
}

/**
 * Merge a config patch into a widget (found by id across all pages). Position-
 * preserving — a config change never moves/compacts widgets (DB-6). Immutable:
 * fresh page/widget/config objects. Used by self-configuring widgets (Weather
 * city, Countdown target, Pinned entity) and DB-8's config popover.
 */
export function updateWidgetConfig(
  layout: DashboardLayout,
  id: string,
  patch: Record<string, unknown>,
): DashboardLayout {
  return {
    version: 1,
    pages: layout.pages.map((page) => ({
      ...page,
      widgets: page.widgets.map((w) =>
        w.id === id ? { ...w, config: { ...w.config, ...patch } } : w,
      ),
    })),
  };
}

// ── Sanitisation (AC11) ─────────────────────────────────────────────────────
//
// Persisted JSONB is untrusted (hand-edited rows, older/newer clients, partial
// writes). Every load runs through here so a corrupt layout degrades to a valid,
// compacted grid — never a crash, never an overlap, never an out-of-bounds cell.
// Hand-rolled (no schema lib) to keep the engine dependency-free and the repair
// rules explicit.

const KNOWN_TYPES: ReadonlySet<string> = new Set(WIDGET_TYPES);
const KNOWN_SIZES: ReadonlySet<string> = new Set(Object.keys(SIZE_SPANS));

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Coerce one raw widget into a valid `WidgetInstance`, or null if unusable.
 * Position is NOT clamped here — that's the page repairer's job, which also
 * resolves overlaps (a widget's clamped-but-overlapping spot must be relocated,
 * which needs the whole-page context).
 */
export function sanitizeWidget(raw: unknown): WidgetInstance | null {
  if (!isObject(raw)) return null;
  const { id, type, size } = raw;
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof type !== "string" || !KNOWN_TYPES.has(type)) return null;
  if (typeof size !== "string" || !KNOWN_SIZES.has(size)) return null;

  const x = Number.isFinite(raw.x) ? Math.trunc(raw.x as number) : 0;
  const y = Number.isFinite(raw.y) ? Math.trunc(raw.y as number) : 0;
  // Shallow-copy so a sanitised layout never aliases the untrusted parsed JSONB.
  const config = isObject(raw.config) ? { ...(raw.config as Record<string, unknown>) } : {};

  return { id, type: type as WidgetInstance["type"], size: size as WidgetSize, x, y, config };
}

/**
 * Repair a page's widgets into a legal arrangement: drop unknown/duplicate
 * entries, clamp into bounds, relocate anything that would overlap, then compact.
 * The result is always overlap-free and in-bounds.
 */
function repairWidgets(rawWidgets: unknown): WidgetInstance[] {
  const list = Array.isArray(rawWidgets) ? rawWidgets : [];
  const accepted: WidgetInstance[] = [];
  const seenIds = new Set<string>();

  for (const raw of list) {
    const widget = sanitizeWidget(raw);
    if (!widget) continue;
    if (seenIds.has(widget.id)) continue; // first occurrence wins
    seenIds.add(widget.id);

    const span = spanOf(widget.size);
    const clamped = {
      x: clamp(widget.x, 0, GRID_COLS - span.w),
      y: clamp(widget.y, 0, GRID_ROWS - span.h),
    };
    if (canPlace(accepted, { x: clamped.x, y: clamped.y, w: span.w, h: span.h })) {
      accepted.push({ ...widget, x: clamped.x, y: clamped.y });
    } else {
      const pos = findFirstFit(accepted, span);
      if (pos) accepted.push({ ...widget, x: pos.x, y: pos.y });
      // else: grid over-full → drop the extra widget rather than overlap.
    }
  }
  return compact(accepted);
}

function sanitizePage(raw: unknown, index: number): DashboardPage {
  const obj = isObject(raw) ? raw : {};
  const id = typeof obj.id === "string" && obj.id.length > 0 ? obj.id : `page-${index}`;
  const page: DashboardPage = { id, widgets: repairWidgets(obj.widgets) };
  if (typeof obj.name === "string" && obj.name.length > 0) page.name = obj.name;
  return page;
}

/**
 * Turn an untrusted stored value into a valid `DashboardLayout`. Guarantees:
 * version 1, ≥1 page, unique page ids, every page overlap-free and in-bounds.
 */
export function sanitizeLayout(raw: unknown): DashboardLayout {
  const obj = isObject(raw) ? raw : {};
  const rawPages = Array.isArray(obj.pages) ? obj.pages : [];

  const usedIds = new Set<string>();
  const pages: DashboardPage[] = rawPages.map((p, i) => {
    let page = sanitizePage(p, i);
    if (usedIds.has(page.id)) page = { ...page, id: `page-${i}` };
    usedIds.add(page.id);
    return page;
  });

  if (pages.length === 0) pages.push({ id: "page-0", widgets: [] });
  return { version: 1, pages };
}

// ── Validation helper (shared by tests & repair reasoning) ──────────────────

/** A layout of widgets is valid iff every one is in-bounds and none overlap. */
export function isValidPlacement(widgets: readonly WidgetInstance[]): boolean {
  for (let i = 0; i < widgets.length; i++) {
    const ri = rectOf(widgets[i]);
    if (!inBounds(ri)) return false;
    for (let j = i + 1; j < widgets.length; j++) {
      if (overlaps(ri, rectOf(widgets[j]))) return false;
    }
  }
  return true;
}
