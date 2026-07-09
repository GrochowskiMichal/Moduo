// The drag layer's pixel↔cell math (DB-3), kept pure so it can be unit-tested
// without a DOM. The engine (`engine/grid-engine.ts`) owns placement/push/compact
// on the abstract 8×4 matrix; THIS file is the thin bridge that turns a live
// pointer gesture into a cell target the engine can resolve, and computes the
// transform that makes the dragged widget follow the finger pixel-for-pixel while
// its underlying grid cell stays snapped.
//
// Zero React/DOM imports (callers pass in the measured rect + gaps), so the same
// two functions that drive the live preview are exercised directly in tests.

import { spanOf } from "./engine/grid-engine";
import { GRID_COLS, GRID_ROWS, type WidgetSize } from "./engine/types";

/** The per-cell pixel stride (cell size + gap) on each axis. */
export interface GridMetrics {
  stepX: number;
  stepY: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A grid cell coordinate (top-left corner), in column/row units. */
export interface Cell {
  x: number;
  y: number;
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Cell stride from the grid's measured rect + its CSS gaps. With `1fr` tracks the
 * columns are equal, so column `c` starts at `c · stepX` where
 * `stepX = (width + colGap) / cols` (width already excludes the (cols−1) gaps, so
 * adding one gap back and dividing by cols yields cell+gap). Same for rows.
 */
export function cellMetrics(
  rect: { width: number; height: number },
  colGap: number,
  rowGap: number,
): GridMetrics {
  return {
    stepX: GRID_COLS > 0 ? (rect.width + colGap) / GRID_COLS : 0,
    stepY: GRID_ROWS > 0 ? (rect.height + rowGap) / GRID_ROWS : 0,
  };
}

/**
 * Which cell the dragged widget's TOP-LEFT should snap to, given how far the
 * pointer has moved since press (`delta`). Anchoring on the widget's own top-left
 * (original cell + delta) rather than the raw pointer means the grab offset within
 * the widget is preserved for free. Rounded to the nearest cell and clamped so the
 * widget's full span always stays inside the 8×4 (AC3 "never outside the bounds").
 */
export function pointerToTargetCell(args: {
  originalCell: Cell;
  delta: Point;
  size: WidgetSize;
  metrics: GridMetrics;
}): Cell {
  const { originalCell, delta, size, metrics } = args;
  const span = spanOf(size);
  const rawCol = originalCell.x + (metrics.stepX > 0 ? delta.x / metrics.stepX : 0);
  const rawRow = originalCell.y + (metrics.stepY > 0 ? delta.y / metrics.stepY : 0);
  return {
    x: clampInt(Math.round(rawCol), 0, GRID_COLS - span.w),
    y: clampInt(Math.round(rawRow), 0, GRID_ROWS - span.h),
  };
}

/**
 * The pixel transform that keeps the dragged widget under the finger while it is
 * grid-placed at `activeCell` (its snapped preview cell). The widget's natural
 * (untransformed) position is `activeCell · step`; we want its visual position to
 * be `originalCell · step + delta` (exactly where the finger dragged it from its
 * start), so the transform is the difference. When `activeCell === originalCell`
 * this is just `delta`; when the snap has advanced a cell, the residual shrinks
 * toward the sub-cell offset — so releasing (transform → gone) is a small settle,
 * never a jump.
 */
export function activeTransform(args: {
  originalCell: Cell;
  activeCell: Cell;
  delta: Point;
  metrics: GridMetrics;
}): Point {
  const { originalCell, activeCell, delta, metrics } = args;
  return {
    x: (originalCell.x - activeCell.x) * metrics.stepX + delta.x,
    y: (originalCell.y - activeCell.y) * metrics.stepY + delta.y,
  };
}
