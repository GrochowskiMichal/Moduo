// DB-5 AC13 — the density budget: a denser setting shows more rows in the same
// cell, and a bigger footprint shows more than a smaller one, at every density.

import { describe, expect, it } from "vitest";

import { isWidgetDensity, widgetRowBudget, widgetVariant } from "./widget-density";

describe("widgetVariant", () => {
  it("maps footprint to content posture", () => {
    expect(widgetVariant("S")).toBe("compact");
    expect(widgetVariant("M")).toBe("standard");
    expect(widgetVariant("XL")).toBe("standard");
    expect(widgetVariant("L")).toBe("expanded");
  });
});

describe("widgetRowBudget (AC13)", () => {
  it("a denser setting shows strictly more rows in the same cell", () => {
    for (const size of ["S", "M", "L", "XL"] as const) {
      const comfy = widgetRowBudget(size, "comfortable");
      const compact = widgetRowBudget(size, "compact");
      const dense = widgetRowBudget(size, "dense");
      expect(compact).toBeGreaterThan(comfy);
      expect(dense).toBeGreaterThan(compact);
    }
  });

  it("a bigger footprint shows more than a smaller one at the same density", () => {
    for (const density of ["comfortable", "compact", "dense"] as const) {
      expect(widgetRowBudget("L", density)).toBeGreaterThan(widgetRowBudget("M", density));
      expect(widgetRowBudget("M", density)).toBeGreaterThan(widgetRowBudget("S", density));
    }
  });

  it("always returns a positive integer", () => {
    for (const size of ["S", "M", "L", "XL"] as const) {
      for (const density of ["comfortable", "compact", "dense"] as const) {
        const n = widgetRowBudget(size, density);
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThan(0);
      }
    }
  });
});

describe("isWidgetDensity", () => {
  it("guards the three density values", () => {
    expect(isWidgetDensity("comfortable")).toBe(true);
    expect(isWidgetDensity("compact")).toBe(true);
    expect(isWidgetDensity("dense")).toBe(true);
    expect(isWidgetDensity("cozy")).toBe(false);
    expect(isWidgetDensity(null)).toBe(false);
  });
});
