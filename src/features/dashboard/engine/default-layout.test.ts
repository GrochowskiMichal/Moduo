// Proves the curated first-run page is a real, legal layout (AC6) — a fresh user
// must never be dropped onto a broken or empty grid.

import { describe, expect, it } from "vitest";

import { createDefaultLayout } from "./default-layout";
import { isValidPlacement, sanitizeLayout, spanOf } from "./grid-engine";
import { GRID_COLS, GRID_ROWS, WIDGET_TYPES } from "./types";

describe("createDefaultLayout", () => {
  const layout = createDefaultLayout();
  const page = layout.pages[0];

  it("is a single 'home' page of four widgets", () => {
    expect(layout.version).toBe(1);
    expect(layout.pages).toHaveLength(1);
    expect(page.id).toBe("home");
    expect(page.widgets).toHaveLength(4);
  });

  it("only uses known widget types", () => {
    for (const widget of page.widgets) {
      expect(WIDGET_TYPES).toContain(widget.type);
    }
  });

  it("is a valid placement (in-bounds, no overlaps)", () => {
    expect(isValidPlacement(page.widgets)).toBe(true);
  });

  it("tiles the whole 8×4 grid with no gaps", () => {
    const area = page.widgets.reduce((sum, x) => {
      const { w, h } = spanOf(x.size);
      return sum + w * h;
    }, 0);
    expect(area).toBe(GRID_COLS * GRID_ROWS);
  });

  it("survives sanitisation unchanged (the seed is already clean)", () => {
    expect(sanitizeLayout(layout)).toEqual(layout);
  });
});
