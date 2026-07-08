// The dashboard grid's data model — the single source of truth for the bounded
// 8×4 "Home" grid (spec: dashboard-rebuild.md, DB-1).
//
// This file is pure declaration: constants, the widget-type vocabulary, and the
// serialisable shapes that get stored in `dashboard_layouts.pages` (Supabase) and
// mirrored to the local cache. The geometry ALGORITHMS live in `grid-engine.ts`;
// keep this file free of logic so both the engine and the (later) React layer can
// import the model without pulling in anything else.

/** The grid is always this many columns/rows and never scrolls (AC1). */
export const GRID_COLS = 8;
export const GRID_ROWS = 4;

/** The four sanctioned widget footprints (AC2). No other spans exist. */
export type WidgetSize = "S" | "M" | "L" | "XL";

/** Cell span (columns × rows) for each size preset. */
export const SIZE_SPANS: Record<WidgetSize, { w: number; h: number }> = {
  S: { w: 2, h: 2 },
  M: { w: 4, h: 2 },
  L: { w: 4, h: 4 },
  XL: { w: 8, h: 2 },
};

/** All size presets, in ascending footprint order (gallery / picker ordering). */
export const WIDGET_SIZES: readonly WidgetSize[] = ["S", "M", "L", "XL"];

/**
 * The v1 widget catalogue (spec §Widget catalog). Declared as a runtime array so
 * `sanitize` has a Set of known types to validate persisted layouts against — a
 * bare TS union gives nothing at runtime. The union type is derived from it.
 *
 * These are the geometry engine's notion of "a known type". Which subset is
 * actually offered in the gallery (permission- / capability-gated) is a registry
 * concern layered on top in DB-5 — the engine only needs to know a type is real.
 */
export const WIDGET_TYPES = [
  "tasks",
  "notes",
  "calendar",
  "timetracking",
  "email",
  "recently-linked",
  "activity",
  "needs-attention",
  "reconnect",
  "clock",
  "weather",
  "pomodoro",
  "countdown",
  "quick-capture",
  "habits",
  "pinned",
] as const;

export type WidgetType = (typeof WIDGET_TYPES)[number];

/** One placed widget on a page. `config` is opaque to the engine — passed through untouched. */
export interface WidgetInstance {
  id: string;
  type: WidgetType;
  size: WidgetSize;
  /** Column of the top-left cell, 0…GRID_COLS-1. */
  x: number;
  /** Row of the top-left cell, 0…GRID_ROWS-1. */
  y: number;
  config: Record<string, unknown>;
}

/** One page of the dashboard. A dashboard always has ≥1 page (edge case). */
export interface DashboardPage {
  id: string;
  /** Optional label — stored for later; v1 UI is dots-only. */
  name?: string;
  widgets: WidgetInstance[];
}

/** The whole persisted layout for one user+workspace. `version` gates future migrations. */
export interface DashboardLayout {
  version: 1;
  pages: DashboardPage[];
}

/** A cell rectangle in grid units. The engine's working currency. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
