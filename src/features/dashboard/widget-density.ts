// DB-5 — density-aware widget content (AC13). Widget bodies read the global
// `data-density` axis (the same one the whole app uses; text-size was retired
// into density per R7) and show MORE rows in the same cell as density tightens.
// The geometry (8×4 + S/M/L/XL spans) is unaffected — only the content budget.
//
// Pure so it's unit-testable; the `useDensity` hook (use-density.ts) supplies
// the live value off the DOM.

import type { WidgetSize } from "./engine/types";

export type WidgetDensity = "comfortable" | "compact" | "dense";

/** Content posture per footprint: a small cell is a glance, a tall cell a list. */
export type WidgetVariant = "compact" | "standard" | "expanded";

export function widgetVariant(size: WidgetSize): WidgetVariant {
  if (size === "S") return "compact";
  if (size === "L") return "expanded";
  return "standard"; // M, XL — wide but short
}

// Base rows a variant shows before "+N more", then a density bonus so a denser
// setting genuinely reveals more (the shorter rows fit). AC13.
const BASE_ROWS: Record<WidgetVariant, number> = {
  compact: 3,
  standard: 5,
  expanded: 9,
};
const DENSITY_BONUS: Record<WidgetDensity, number> = {
  comfortable: 0,
  compact: 1,
  dense: 3,
};

/** How many rows a widget of this size shows at this density before "+N more". */
export function widgetRowBudget(size: WidgetSize, density: WidgetDensity): number {
  return BASE_ROWS[widgetVariant(size)] + DENSITY_BONUS[density];
}

export function isWidgetDensity(value: unknown): value is WidgetDensity {
  return value === "comfortable" || value === "compact" || value === "dense";
}
