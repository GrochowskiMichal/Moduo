// Proves the grid engine's invariants — the risk core of the dashboard rebuild.
// Where behaviour is a heuristic (which widget goes where when pushed), we assert
// the INVARIANTS (in-bounds, no overlap, active lands at target, reject leaves the
// input untouched) rather than exact positions — the robust way to test physics.

import { describe, expect, it } from "vitest";
import {
  addWidget,
  canPlace,
  compact,
  findFirstFit,
  inBounds,
  isValidPlacement,
  overlaps,
  rectOf,
  removeWidget,
  resizeWidget,
  resolveDrag,
  sanitizeLayout,
  sanitizeWidget,
  spanOf,
} from "./grid-engine";
import type { WidgetInstance, WidgetSize, WidgetType } from "./types";
import { GRID_COLS, GRID_ROWS, SIZE_SPANS } from "./types";

function w(id: string, type: WidgetType, size: WidgetSize, x: number, y: number): WidgetInstance {
  return { id, type, size, x, y, config: {} };
}

/** A layout that tiles the whole 8×4 with eight S widgets — the "grid is full" fixture. */
function fullOfS(): WidgetInstance[] {
  const out: WidgetInstance[] = [];
  let n = 0;
  for (let y = 0; y < GRID_ROWS; y += 2) {
    for (let x = 0; x < GRID_COLS; x += 2) {
      out.push(w(`s${n++}`, "clock", "S", x, y));
    }
  }
  return out; // 8 widgets, 32 cells
}

function snapshot(widgets: WidgetInstance[]): WidgetInstance[] {
  return JSON.parse(JSON.stringify(widgets)) as WidgetInstance[];
}

// ── geometry primitives ──────────────────────────────────────────────────────

describe("size presets & geometry (AC2)", () => {
  it("declares exactly the four sanctioned spans", () => {
    expect(SIZE_SPANS).toEqual({
      S: { w: 2, h: 2 },
      M: { w: 4, h: 2 },
      L: { w: 4, h: 4 },
      XL: { w: 8, h: 2 },
    });
  });

  it("spanOf / rectOf read the preset", () => {
    expect(spanOf("L")).toEqual({ w: 4, h: 4 });
    expect(rectOf(w("a", "tasks", "M", 1, 2))).toEqual({ x: 1, y: 2, w: 4, h: 2 });
  });

  it("inBounds respects the 8×4 walls", () => {
    expect(inBounds({ x: 0, y: 0, w: 8, h: 4 })).toBe(true); // exactly fills
    expect(inBounds({ x: 4, y: 0, w: 4, h: 2 })).toBe(true);
    expect(inBounds({ x: 5, y: 0, w: 4, h: 2 })).toBe(false); // 5+4=9 > 8
    expect(inBounds({ x: 0, y: 3, w: 2, h: 2 })).toBe(false); // 3+2=5 > 4
    expect(inBounds({ x: -1, y: 0, w: 2, h: 2 })).toBe(false);
  });

  it("overlaps: shared area yes, touching edges no", () => {
    expect(overlaps({ x: 0, y: 0, w: 2, h: 2 }, { x: 1, y: 1, w: 2, h: 2 })).toBe(true);
    expect(overlaps({ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 0, w: 2, h: 2 })).toBe(false);
    expect(overlaps({ x: 0, y: 0, w: 2, h: 2 }, { x: 0, y: 2, w: 2, h: 2 })).toBe(false);
  });

  it("canPlace honours occupants and ignoreIds", () => {
    const board = [w("a", "clock", "S", 0, 0)];
    expect(canPlace(board, { x: 0, y: 0, w: 2, h: 2 })).toBe(false);
    expect(canPlace(board, { x: 2, y: 0, w: 2, h: 2 })).toBe(true);
    expect(canPlace(board, { x: 0, y: 0, w: 2, h: 2 }, new Set(["a"]))).toBe(true);
  });
});

// ── findFirstFit (fit/bounds — AC1, AC3) ─────────────────────────────────────

describe("findFirstFit", () => {
  it("returns the top-left cell on an empty grid", () => {
    expect(findFirstFit([], spanOf("S"))).toEqual({ x: 0, y: 0 });
    expect(findFirstFit([], spanOf("XL"))).toEqual({ x: 0, y: 0 });
  });

  it("scans in reading order (row-major)", () => {
    const board = [w("a", "clock", "S", 0, 0)];
    expect(findFirstFit(board, spanOf("S"))).toEqual({ x: 2, y: 0 });
  });

  it("returns null when nothing fits", () => {
    expect(findFirstFit(fullOfS(), spanOf("S"))).toBeNull();
    // An XL never fits once any row-0/1 cell is taken across the width.
    expect(findFirstFit([w("a", "clock", "S", 0, 0)], spanOf("XL"))).toEqual({ x: 0, y: 2 });
    expect(findFirstFit([w("a", "clock", "S", 0, 2)], spanOf("XL"))).toEqual({ x: 0, y: 0 });
  });
});

// ── compaction (push/compact — AC3) ──────────────────────────────────────────

describe("compact", () => {
  it("pulls a lone widget to the top-left", () => {
    expect(compact([w("a", "clock", "S", 4, 2)])).toEqual([w("a", "clock", "S", 0, 0)]);
  });

  it("closes gaps up-then-left and stays valid", () => {
    const result = compact([w("a", "clock", "S", 2, 0), w("b", "clock", "S", 6, 2)]);
    expect(isValidPlacement(result)).toBe(true);
    // Everything hugs the top-left; no widget floats away from row/col 0 lanes.
    expect(result.find((r) => r.id === "a")).toMatchObject({ x: 0, y: 0 });
  });

  it("preserves input array order (only positions change)", () => {
    const result = compact([w("z", "clock", "S", 6, 2), w("a", "clock", "S", 2, 0)]);
    expect(result.map((r) => r.id)).toEqual(["z", "a"]);
  });

  it("is idempotent", () => {
    for (const fixture of [
      [w("a", "clock", "S", 2, 0), w("b", "tasks", "M", 4, 2)],
      [w("a", "notes", "L", 4, 0), w("b", "clock", "S", 0, 2), w("c", "clock", "S", 2, 2)],
      fullOfS(),
    ]) {
      const once = compact(fixture);
      expect(compact(once)).toEqual(once);
    }
  });

  it("does not mutate its input", () => {
    const input = [w("a", "clock", "S", 4, 2)];
    const before = snapshot(input);
    compact(input);
    expect(input).toEqual(before);
  });

  it("keeps pinned widgets fixed while others compact around them", () => {
    const result = compact(
      [w("pin", "clock", "S", 6, 2), w("b", "clock", "S", 2, 0)],
      new Set(["pin"]),
    );
    expect(result.find((r) => r.id === "pin")).toMatchObject({ x: 6, y: 2 });
    expect(isValidPlacement(result)).toBe(true);
  });
});

// ── resolveDrag (the crux — AC3) ─────────────────────────────────────────────

describe("resolveDrag", () => {
  it("lands the active widget at the (clamped) target", () => {
    const board = [w("a", "clock", "S", 0, 0), w("b", "clock", "S", 2, 0)];
    const result = resolveDrag(board, "b", { x: 4, y: 2 });
    expect(result).not.toBeNull();
    expect(result!.find((r) => r.id === "b")).toMatchObject({ x: 4, y: 2 });
    expect(isValidPlacement(result!)).toBe(true);
  });

  it("displaces the occupant of the target and stays valid", () => {
    const board = [w("a", "clock", "S", 0, 0), w("b", "clock", "S", 2, 0)];
    const result = resolveDrag(board, "b", { x: 0, y: 0 });
    expect(result).not.toBeNull();
    expect(result!.find((r) => r.id === "b")).toMatchObject({ x: 0, y: 0 });
    // 'a' had to move off (0,0); wherever it went it must be legal.
    expect(isValidPlacement(result!)).toBe(true);
  });

  it("clamps an out-of-bounds target so the active widget stays on the grid", () => {
    const result = resolveDrag([w("a", "notes", "L", 0, 0)], "a", { x: 99, y: 99 });
    expect(result).not.toBeNull();
    // L is 4×4 → max top-left is (4, 0).
    expect(result![0]).toMatchObject({ x: 4, y: 0 });
    expect(isValidPlacement(result!)).toBe(true);
  });

  it("returns null (reject) when a displaced widget can't be placed", () => {
    // Active S dragged to the centre blocks row 1–2, so the XL has no 8×2 slot.
    const board = [w("xl", "calendar", "XL", 0, 0), w("s", "clock", "S", 6, 2)];
    const before = snapshot(board);
    const result = resolveDrag(board, "s", { x: 3, y: 1 });
    expect(result).toBeNull();
    expect(board).toEqual(before); // input byte-identical after a reject
  });

  it("returns null when the active id is unknown", () => {
    expect(resolveDrag([w("a", "clock", "S", 0, 0)], "nope", { x: 0, y: 0 })).toBeNull();
  });

  it("does not mutate its input on success", () => {
    const board = [w("a", "clock", "S", 0, 0), w("b", "clock", "S", 2, 0)];
    const before = snapshot(board);
    resolveDrag(board, "b", { x: 4, y: 0 });
    expect(board).toEqual(before);
  });
});

// ── resize (AC2/AC3) ─────────────────────────────────────────────────────────

describe("resizeWidget", () => {
  it("grows a widget when there is room", () => {
    const result = resizeWidget([w("a", "tasks", "S", 0, 0)], "a", "L");
    expect(result).not.toBeNull();
    expect(result![0]).toMatchObject({ size: "L" });
    expect(isValidPlacement(result!)).toBe(true);
  });

  it("returns null when the new size cannot fit even after pushing", () => {
    // A→L needs the full height of cols 0–3; the XL then has no 8-wide slot left.
    const board = [w("a", "tasks", "S", 0, 0), w("b", "calendar", "XL", 0, 2)];
    const result = resizeWidget(board, "a", "L");
    expect(result).toBeNull();
  });

  it("clones (no-op) when the size is unchanged", () => {
    const board = [w("a", "tasks", "S", 0, 0)];
    const result = resizeWidget(board, "a", "S");
    expect(result).toEqual(board);
    expect(result).not.toBe(board);
  });

  it("returns null for an unknown id", () => {
    expect(resizeWidget([w("a", "tasks", "S", 0, 0)], "nope", "L")).toBeNull();
  });
});

// ── add / remove ─────────────────────────────────────────────────────────────

describe("addWidget", () => {
  it("places at the first free slot", () => {
    const result = addWidget([], w("a", "clock", "S", 5, 5));
    expect(result).toEqual([w("a", "clock", "S", 0, 0)]);
  });

  it("returns null when the grid is full", () => {
    expect(addWidget(fullOfS(), w("x", "clock", "S", 0, 0))).toBeNull();
  });
});

describe("removeWidget", () => {
  it("removes and compacts the survivors", () => {
    const result = removeWidget([w("a", "clock", "S", 0, 0), w("b", "clock", "S", 2, 0)], "a");
    expect(result).toEqual([w("b", "clock", "S", 0, 0)]);
  });

  it("is a no-op array (still valid) when the id is absent", () => {
    const result = removeWidget([w("a", "clock", "S", 2, 0)], "ghost");
    expect(result).toEqual([w("a", "clock", "S", 0, 0)]); // still compacts
  });
});

// ── sanitisation (AC11) ──────────────────────────────────────────────────────

describe("sanitizeWidget", () => {
  it("accepts a well-formed widget and copies its config (no aliasing untrusted input)", () => {
    const raw = { id: "a", type: "tasks", size: "M", x: 2, y: 1, config: { projectIds: [] } };
    const out = sanitizeWidget(raw)!;
    expect(out).toEqual(raw);
    expect(out.config).not.toBe(raw.config); // fresh object — mutating it can't corrupt the JSONB
  });

  it("rejects missing id / unknown type / unknown size / non-object", () => {
    expect(sanitizeWidget({ type: "tasks", size: "S" })).toBeNull();
    expect(sanitizeWidget({ id: "a", type: "bogus", size: "S" })).toBeNull();
    expect(sanitizeWidget({ id: "a", type: "tasks", size: "XXL" })).toBeNull();
    expect(sanitizeWidget(null)).toBeNull();
    expect(sanitizeWidget("nope")).toBeNull();
  });

  it("defaults non-finite coords to 0 and a bad config to {}", () => {
    const out = sanitizeWidget({ id: "a", type: "clock", size: "S", x: "NaN", config: 7 });
    expect(out).toEqual({ id: "a", type: "clock", size: "S", x: 0, y: 0, config: {} });
  });
});

describe("sanitizeLayout", () => {
  it("turns total garbage into one empty page", () => {
    for (const garbage of [null, undefined, 42, "layout", {}, { pages: "no" }]) {
      const out = sanitizeLayout(garbage);
      expect(out.version).toBe(1);
      expect(out.pages).toHaveLength(1);
      expect(out.pages[0].widgets).toEqual([]);
    }
  });

  it("drops unknown widget types but keeps the good ones", () => {
    const out = sanitizeLayout({
      version: 1,
      pages: [
        {
          id: "p",
          widgets: [
            { id: "ok", type: "tasks", size: "S", x: 0, y: 0, config: {} },
            { id: "bad", type: "stocks", size: "S", x: 2, y: 0, config: {} },
          ],
        },
      ],
    });
    expect(out.pages[0].widgets.map((x) => x.id)).toEqual(["ok"]);
  });

  it("repairs out-of-bounds and overlapping widgets into a legal grid", () => {
    const out = sanitizeLayout({
      version: 1,
      pages: [
        {
          id: "p",
          widgets: [
            { id: "a", type: "tasks", size: "S", x: 99, y: 99, config: {} }, // out of bounds
            { id: "b", type: "notes", size: "S", x: 0, y: 0, config: {} },
            { id: "c", type: "clock", size: "S", x: 0, y: 0, config: {} }, // overlaps b
          ],
        },
      ],
    });
    expect(out.pages[0].widgets).toHaveLength(3);
    expect(isValidPlacement(out.pages[0].widgets)).toBe(true);
  });

  it("drops duplicate widget ids (first wins) and dedupes page ids", () => {
    const out = sanitizeLayout({
      version: 1,
      pages: [
        {
          id: "dup",
          widgets: [
            { id: "a", type: "tasks", size: "S", x: 0, y: 0, config: {} },
            { id: "a", type: "notes", size: "S", x: 2, y: 0, config: {} },
          ],
        },
        { id: "dup", widgets: [] },
      ],
    });
    expect(out.pages[0].widgets).toHaveLength(1);
    expect(out.pages[0].widgets[0].type).toBe("tasks");
    expect(new Set(out.pages.map((p) => p.id)).size).toBe(out.pages.length);
  });

  it("leaves a fully-valid layout untouched (round-trip)", () => {
    const layout = {
      version: 1 as const,
      pages: [
        {
          id: "home",
          widgets: [
            { id: "a", type: "tasks" as const, size: "L" as const, x: 0, y: 0, config: {} },
            { id: "b", type: "calendar" as const, size: "M" as const, x: 4, y: 0, config: {} },
          ],
        },
      ],
    };
    expect(sanitizeLayout(layout)).toEqual(layout);
  });
});

// ── config immutability (purity contract) ────────────────────────────────────

describe("config immutability", () => {
  it("returns fresh config objects — mutating an output can't corrupt the input", () => {
    const input = [w("a", "clock", "S", 2, 2)];
    input[0].config.n = 1;

    const outputs = [
      compact(input),
      addWidget([], input[0])!,
      resizeWidget(input, "a", "M")!,
      resolveDrag(input, "a", { x: 0, y: 0 })!,
    ];
    for (const out of outputs) {
      const widget = out.find((x) => x.id === "a")!;
      expect(widget.config).not.toBe(input[0].config);
      widget.config.n = 999;
    }
    expect(input[0].config).toEqual({ n: 1 }); // untouched despite the mutations above
  });
});

// ── property-based invariants (AC1 bounds / AC3 physics / AC11 repair) ────────

/** Deterministic PRNG (mulberry32) — reproducible fuzzing, no Math.random. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SIZES: WidgetSize[] = ["S", "M", "L", "XL"];

/** Build a valid random layout by repeatedly adding random-size widgets (add guarantees validity). */
function randomLayout(rng: () => number, maxWidgets: number): WidgetInstance[] {
  let widgets: WidgetInstance[] = [];
  const n = 1 + Math.floor(rng() * maxWidgets);
  for (let i = 0; i < n; i++) {
    const size = SIZES[Math.floor(rng() * SIZES.length)];
    const next = addWidget(widgets, w(`w${i}`, "clock", size, 0, 0));
    if (next) widgets = next;
  }
  return widgets;
}

describe("invariants (property)", () => {
  it("every resolveDrag result is in-bounds, overlap-free, membership-preserving, active-at-target", () => {
    const rng = prng(0x1234);
    for (let iter = 0; iter < 400; iter++) {
      const widgets = randomLayout(rng, 8);
      if (widgets.length === 0) continue;
      const active = widgets[Math.floor(rng() * widgets.length)];
      const target = { x: Math.floor(rng() * GRID_COLS), y: Math.floor(rng() * GRID_ROWS) };
      const before = snapshot(widgets);

      const out = resolveDrag(widgets, active.id, target);
      expect(widgets).toEqual(before); // never mutates the input, success or reject
      if (out === null) continue;

      expect(isValidPlacement(out)).toBe(true);
      expect(new Set(out.map((x) => x.id))).toEqual(new Set(widgets.map((x) => x.id)));
      const span = spanOf(active.size);
      const cx = Math.min(Math.max(target.x, 0), GRID_COLS - span.w);
      const cy = Math.min(Math.max(target.y, 0), GRID_ROWS - span.h);
      expect(out.find((x) => x.id === active.id)).toMatchObject({ x: cx, y: cy });
    }
  });

  it("compact is always valid and idempotent", () => {
    const rng = prng(0x9e3d);
    for (let iter = 0; iter < 300; iter++) {
      const once = compact(randomLayout(rng, 8));
      expect(isValidPlacement(once)).toBe(true);
      expect(compact(once)).toEqual(once);
    }
  });

  it("sanitizeLayout never throws and always yields valid, non-empty pages on garbage", () => {
    const rng = prng(0x5eed);
    const badTypes = ["tasks", "stocks", "", "clock", 42, null];
    const badSizes = ["S", "XXL", "M", null, 7, "L"];
    for (let iter = 0; iter < 300; iter++) {
      const widgets = Array.from({ length: Math.floor(rng() * 12) }, (_, k) => ({
        id: rng() < 0.15 ? "dup" : `w${k}`,
        type: badTypes[Math.floor(rng() * badTypes.length)],
        size: badSizes[Math.floor(rng() * badSizes.length)],
        x: Math.floor(rng() * 20) - 4, // negatives + out-of-bounds
        y: rng() < 0.1 ? NaN : Math.floor(rng() * 10) - 2,
        config: rng() < 0.1 ? [1, 2] : { k },
      }));
      const out = sanitizeLayout({ version: 1, pages: [{ id: "p", widgets }] });
      expect(out.pages.length).toBeGreaterThanOrEqual(1);
      for (const page of out.pages) expect(isValidPlacement(page.widgets)).toBe(true);
    }
  });
});
