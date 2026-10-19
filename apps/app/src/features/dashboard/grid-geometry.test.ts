import { describe, expect, it } from "@rstest/core";

import { cellMetrics, pointerToTargetCell } from "./grid-geometry";

// A convenient exact grid: 8 cols × 4 rows in a 796×308 box with a 12px gap makes
// stepX = (796 + 12) / 8 = 101 and stepY = (308 + 12) / 4 = 80 — whole numbers, so
// "move one cell" is exactly one step and the assertions read cleanly.
const RECT = { width: 796, height: 308 };
const GAP = 12;
const METRICS = cellMetrics(RECT, GAP, GAP); // { stepX: 101, stepY: 80 }

describe("cellMetrics", () => {
  it("derives the per-cell stride from the rect + gaps", () => {
    expect(METRICS.stepX).toBe(101);
    expect(METRICS.stepY).toBe(80);
  });

  it("is gap-inclusive: 8 strides − 1 gap === the content width", () => {
    // 8 cells + 7 gaps must reconstruct the measured width.
    const cellW = METRICS.stepX - GAP;
    expect(cellW * 8 + GAP * 7).toBe(RECT.width);
  });

  it("returns zero strides for an unmeasured (0×0) rect instead of NaN", () => {
    const m = cellMetrics({ width: 0, height: 0 }, GAP, GAP);
    expect(m.stepX).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(m.stepX)).toBe(true);
  });
});

describe("pointerToTargetCell", () => {
  const originalCell = { x: 2, y: 1 };

  it("no movement keeps the original cell", () => {
    expect(
      pointerToTargetCell({ originalCell, delta: { x: 0, y: 0 }, size: "S", metrics: METRICS }),
    ).toEqual({ x: 2, y: 1 });
  });

  it("a full-step drag advances exactly one cell", () => {
    expect(
      pointerToTargetCell({
        originalCell,
        delta: { x: METRICS.stepX, y: METRICS.stepY },
        size: "S",
        metrics: METRICS,
      }),
    ).toEqual({ x: 3, y: 2 });
  });

  it("rounds to the nearest cell at the half-step boundary", () => {
    // just under half a step → stays; just over → advances.
    expect(
      pointerToTargetCell({
        originalCell,
        delta: { x: METRICS.stepX * 0.49, y: 0 },
        size: "S",
        metrics: METRICS,
      }).x,
    ).toBe(2);
    expect(
      pointerToTargetCell({
        originalCell,
        delta: { x: METRICS.stepX * 0.51, y: 0 },
        size: "S",
        metrics: METRICS,
      }).x,
    ).toBe(3);
  });

  it("clamps so an S widget's 2×2 span never leaves the 8×4 bounds", () => {
    const target = pointerToTargetCell({
      originalCell: { x: 6, y: 2 },
      delta: { x: METRICS.stepX * 5, y: METRICS.stepY * 5 }, // yank far past the edge
      size: "S",
      metrics: METRICS,
    });
    expect(target).toEqual({ x: 6, y: 2 }); // max top-left for a 2×2 is (6,2)
  });

  it("clamps a wide XL (8×2) to the only column it can occupy", () => {
    const target = pointerToTargetCell({
      originalCell: { x: 0, y: 0 },
      delta: { x: METRICS.stepX * 3, y: METRICS.stepY * 3 },
      size: "XL",
      metrics: METRICS,
    });
    expect(target).toEqual({ x: 0, y: 2 }); // XL spans all 8 cols → x pinned to 0; y max is 2
  });

  it("never returns a negative cell when dragged up-left past the origin", () => {
    const target = pointerToTargetCell({
      originalCell: { x: 1, y: 1 },
      delta: { x: -METRICS.stepX * 5, y: -METRICS.stepY * 5 },
      size: "M",
      metrics: METRICS,
    });
    expect(target).toEqual({ x: 0, y: 0 });
  });
});
