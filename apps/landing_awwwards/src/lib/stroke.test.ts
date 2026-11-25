// The stroke geometry the whole site is drawn with. A chain at the mark's offset must rebuild the
// mark (strokes 194.24 apart, 331.51 wide, windows where neighbors overlap), and the gaps must
// mean what the driver assumes (1 = interlocked, TOUCH = just touching, 0 = stacked).
import { describe, expect, it } from "@rstest/core";

import {
  chainLayers,
  chainWidth,
  chainX,
  MARK_X,
  STROKE,
  strokePath,
  TOUCH,
  uniformGaps,
  windowCenter,
} from "./stroke";

/** Every x coordinate in a path of absolute M, L and C commands (V only moves y). */
const xsOf = (d: string) =>
  [...d.matchAll(/[MLC]([^MLCVZ]*)/g)].flatMap(([, nums]) =>
    nums
      .trim()
      .split(/\s+/)
      .map(Number)
      .filter((_, i) => i % 2 === 0),
  );

describe("strokePath", () => {
  it("puts the stroke's left edge where it is asked to", () => {
    for (const dx of [0, 140, 528.485]) {
      const xs = xsOf(strokePath(dx));
      expect(Math.min(...xs)).toBeCloseTo(dx, 1);
      expect(Math.max(...xs)).toBeCloseTo(dx + STROKE.w, 1);
    }
  });

  it("is one closed shape", () => {
    const d = strokePath(0);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d.match(/M/g)).toHaveLength(1);
  });
});

describe("chains", () => {
  it("rebuilds the mark's three strokes at the mark's offset", () => {
    expect(MARK_X.map((x) => x + 140)).toEqual([140, 140 + STROKE.offset, 140 + 2 * STROKE.offset]);
    expect(chainWidth(MARK_X) + 140).toBeCloseTo(860, 0);
  });

  it("opens a window between neighbors that overlap, and none when they touch", () => {
    const interlocked = chainX(uniformGaps(6, 1));
    for (let k = 0; k < 5; k++) {
      const c = windowCenter(interlocked, k)!;
      expect(c.open).toBeCloseTo(1, 5);
      expect(c.y).toBe(STROKE.windowY);
    }
    const apart = chainX(uniformGaps(6, TOUCH + 0.01));
    for (let k = 0; k < 5; k++) expect(windowCenter(apart, k)).toBeNull();
  });

  it("splits a chain into even and odd layers, so stacked strokes cancel to nothing", () => {
    const stacked = chainX(uniformGaps(6, 0));
    const { a, b } = chainLayers(stacked);
    expect(a.match(/M/g)).toHaveLength(3);
    expect(b.match(/M/g)).toHaveLength(3);
    // Every stroke sits in the same place: A and B cover exactly the same area.
    expect(new Set(a.split("Z").filter(Boolean)).size).toBe(1);
    expect(new Set(b.split("Z").filter(Boolean))).toEqual(new Set(a.split("Z").filter(Boolean)));
  });
});
