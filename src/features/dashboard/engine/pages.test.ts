import { describe, expect, it } from "@rstest/core";

import { addPage, removePage, setPageWidgets } from "./grid-engine";
import type { DashboardLayout, WidgetInstance } from "./types";

function widget(id: string, x: number, y: number): WidgetInstance {
  return { id, type: "clock", size: "S", x, y, config: {} };
}

function layout(pages: DashboardLayout["pages"]): DashboardLayout {
  return { version: 1, pages };
}

describe("addPage", () => {
  it("appends a fresh empty page with the given id", () => {
    const before = layout([{ id: "home", widgets: [widget("a", 0, 0)] }]);
    const after = addPage(before, "p2");
    expect(after.pages).toHaveLength(2);
    expect(after.pages[1]).toEqual({ id: "p2", widgets: [] });
    // The original page is preserved.
    expect(after.pages[0]).toEqual(before.pages[0]);
  });

  it("does not mutate the input", () => {
    const before = layout([{ id: "home", widgets: [] }]);
    addPage(before, "p2");
    expect(before.pages).toHaveLength(1);
  });
});

describe("removePage", () => {
  it("removes the named page", () => {
    const before = layout([
      { id: "home", widgets: [] },
      { id: "p2", widgets: [] },
    ]);
    const after = removePage(before, "home");
    expect(after.pages.map((p) => p.id)).toEqual(["p2"]);
  });

  it("never removes the last page (AC5 — a dashboard always keeps ≥1)", () => {
    const before = layout([{ id: "home", widgets: [widget("a", 0, 0)] }]);
    expect(removePage(before, "home")).toBe(before); // no-op, same reference
  });

  it("is a no-op for an unknown id", () => {
    const before = layout([
      { id: "home", widgets: [] },
      { id: "p2", widgets: [] },
    ]);
    expect(removePage(before, "nope")).toBe(before);
  });
});

describe("setPageWidgets", () => {
  it("replaces only the target page's widgets", () => {
    const before = layout([
      { id: "home", widgets: [widget("a", 0, 0)] },
      { id: "p2", widgets: [widget("b", 0, 0)] },
    ]);
    const next = [widget("a", 2, 0), widget("c", 4, 0)];
    const after = setPageWidgets(before, "home", next);
    expect(after.pages[0].widgets).toEqual(next);
    expect(after.pages[1]).toEqual(before.pages[1]); // p2 untouched
    expect(before.pages[0].widgets).toHaveLength(1); // input not mutated
  });
});
