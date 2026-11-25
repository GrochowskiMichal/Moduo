// The specimen's math: the distance field must put the outline where the raster does, the cast
// must see a face head on, side walls when turned and only walls edge on, the turn must keep
// the face toward you nearly always, and the readout must say what the frame shows.
import { describe, expect, it } from "@rstest/core";

import {
  cast,
  distanceField,
  EMPTY,
  FACE,
  FRAMES,
  frontOf,
  type Grid,
  readout,
  SIDE,
  SPIN_AT,
  THR,
  turn,
} from "./specimen";

/** A w × h field with a filled square of side s in the middle. */
function square(w: number, h: number, s: number) {
  const inside = new Uint8Array(w * h);
  const x0 = (w - s) / 2;
  const y0 = (h - s) / 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      inside[y * w + x] = x >= x0 && x < x0 + s && y >= y0 && y < y0 + s ? 1 : 0;
  return distanceField(inside, w, h);
}

/** A grid of 1 px cells over the field, its center on the field's center, one field px a cell. */
function grid(cols: number, rows: number): Grid {
  return { cols, rows, cellW: 1, cellH: 1, ox: cols / 2, oy: rows / 2, scale: 1 };
}

function count(kind: Uint8Array, k: number) {
  return kind.reduce((n, v) => n + (v === k ? 1 : 0), 0);
}

describe("distanceField", () => {
  const F = square(40, 40, 20);
  it("is negative inside, positive outside, and near zero on the outline", () => {
    expect(F.d[20 * 40 + 20]).toBeLessThan(-8);
    expect(F.d[2 * 40 + 2]).toBeGreaterThan(8);
    // Pixel 10 is the square's first column: its center is half a pixel inside.
    expect(F.d[20 * 40 + 10]).toBeCloseTo(-0.5, 5);
    expect(F.d[20 * 40 + 9]).toBeCloseTo(0.5, 5);
  });
});

describe("cast", () => {
  const F = square(60, 60, 30);
  const g = grid(60, 60);
  const lum = new Float32Array(60 * 60);
  const kind = new Uint8Array(60 * 60);

  it("sees only the face, the square's size, head on", () => {
    cast(F, 10, { yaw: 0, pitch: 0 }, g, lum, kind);
    expect(count(kind, SIDE)).toBe(0);
    expect(count(kind, FACE)).toBe(30 * 30);
    expect(kind[30 * 60 + 30]).toBe(FACE);
    expect(kind[2 * 60 + 2]).toBe(EMPTY);
  });

  it("shows one side wall when turned, and lights the face more than the wall", () => {
    cast(F, 10, { yaw: 0.6, pitch: 0 }, g, lum, kind);
    const sides = count(kind, SIDE);
    expect(sides).toBeGreaterThan(0);
    expect(count(kind, FACE)).toBeGreaterThan(sides);
    const face = lum[kind.indexOf(FACE)];
    expect(face).toBeGreaterThan(0);
    expect(face).toBeLessThanOrEqual(1);
  });

  it("sees only walls edge on, a strip as wide as the solid is deep", () => {
    cast(F, 10, { yaw: Math.PI / 2, pitch: 0 }, g, lum, kind);
    expect(count(kind, FACE)).toBe(0);
    const row = [...kind.subarray(30 * 60, 31 * 60)];
    const wide = row.filter((v) => v === SIDE).length;
    expect(wide).toBeGreaterThanOrEqual(9);
    expect(wide).toBeLessThanOrEqual(11);
  });
});

describe("turn", () => {
  it("faces you at the start, the middle and the end of a cycle, a whole turn on", () => {
    expect(turn(0)).toBe(0);
    expect(turn(0.5)).toBeCloseTo(0, 10);
    expect(turn(1)).toBeCloseTo(2 * Math.PI, 10);
    expect(turn(3.5)).toBeCloseTo(6 * Math.PI, 10);
  });
  it("sways near the front, then spins a whole turn at the end of the cycle", () => {
    for (let u = 0; u <= SPIN_AT; u += 0.01) expect(Math.abs(turn(u))).toBeLessThan(0.33);
    expect(turn(0.995) - turn(SPIN_AT)).toBeGreaterThan(5.5);
  });
  it("is edge on or showing its back for under a tenth of the cycle", () => {
    let away = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) if (Math.cos(turn(i / n)) < 0.4) away++;
    expect(away / n).toBeLessThan(0.1);
  });
});

describe("frontOf", () => {
  it("picks the front nearest in yaw, never a whole spin away", () => {
    expect(frontOf(0.3)).toBe(0.5);
    expect(frontOf(0.1)).toBe(0);
    // Just into the spin: back to the sway's front, not on through the turn.
    expect(frontOf(0.79)).toBe(0.5);
    // Nearly round: on to the next front.
    expect(frontOf(0.97)).toBe(1);
  });
});

describe("readout", () => {
  const base = {
    phase: "sway" as const,
    at: 0.5,
    thr: THR,
    move: 0.153,
    cols: 84,
    rows: 80,
    yaw: Math.PI,
    pitch: 0.07,
  };
  it("says the cycle and what it is doing, the frame, the threshold, the grid and the pose", () => {
    const r = readout(base);
    expect(r.cycle).toBe("CYCLE 001");
    expect(r.what).toBe("SWAY");
    expect(r.frame).toBe("F 0360/0720  12.00S");
    expect(FRAMES).toBe(720);
    expect(r.thr).toBe("THR 0.57  MOVE 15%  HOLD 12");
    expect(r.grid).toBe("GRID 84×80");
    expect(r.pose).toBe("YAW 180°  PITCH 04°");
  });
  it("counts cycles, wraps the frame and the yaw, and says when it is locked", () => {
    const r = readout({ ...base, at: 3.25, yaw: -Math.PI / 2, phase: "locked" });
    expect(r.cycle).toBe("CYCLE 004");
    expect(r.frame.startsWith("F 0180/")).toBe(true);
    expect(r.pose.startsWith("YAW 270°")).toBe(true);
    expect(r.what).toBe("LOCKED");
    expect(readout({ ...base, yaw: 2 * Math.PI - 1e-4 }).pose.startsWith("YAW 000°")).toBe(true);
  });
  it("never sets a dash", () => {
    for (const line of Object.values(readout(base))) expect(line).not.toMatch(/[\u2013\u2014-]/);
  });
});
