// DB-6/DB-8 — the config-write mechanism: updateWidgetConfig merges a patch into
// one widget, immutably, position-preserving (never moves/compacts).

import { describe, expect, it } from "@rstest/core";

import { updateWidgetConfig } from "./grid-engine";
import type { DashboardLayout } from "./types";

function layout(): DashboardLayout {
  return {
    version: 1,
    pages: [
      {
        id: "home",
        widgets: [
          { id: "a", type: "clock", size: "S", x: 2, y: 2, config: { timezones: ["UTC"] } },
          { id: "b", type: "weather", size: "S", x: 0, y: 0, config: {} },
        ],
      },
      {
        id: "p2",
        widgets: [{ id: "c", type: "pomodoro", size: "S", x: 4, y: 0, config: {} }],
      },
    ],
  };
}

describe("updateWidgetConfig", () => {
  it("merges the patch into the target widget's config", () => {
    const next = updateWidgetConfig(layout(), "a", { timezones: ["Europe/London"] });
    const a = next.pages[0].widgets.find((w) => w.id === "a")!;
    expect(a.config).toEqual({ timezones: ["Europe/London"] });
  });

  it("preserves position + size (never compacts/moves)", () => {
    const next = updateWidgetConfig(layout(), "a", { foo: 1 });
    const a = next.pages[0].widgets.find((w) => w.id === "a")!;
    expect({ x: a.x, y: a.y, size: a.size }).toEqual({ x: 2, y: 2, size: "S" });
    // sibling untouched
    const b = next.pages[0].widgets.find((w) => w.id === "b")!;
    expect({ x: b.x, y: b.y }).toEqual({ x: 0, y: 0 });
  });

  it("finds the widget on any page", () => {
    const next = updateWidgetConfig(layout(), "c", { pomodoroWorkMinutes: 50 });
    expect(next.pages[1].widgets[0].config).toEqual({ pomodoroWorkMinutes: 50 });
  });

  it("is a no-op for an unknown id (fresh objects, same content)", () => {
    const before = layout();
    const next = updateWidgetConfig(before, "zzz", { x: 1 });
    expect(next).toEqual(before);
  });

  it("is immutable — the input is not mutated", () => {
    const before = layout();
    const beforeConfig = before.pages[0].widgets[0].config;
    updateWidgetConfig(before, "a", { timezones: ["Asia/Tokyo"] });
    expect(before.pages[0].widgets[0].config).toBe(beforeConfig);
    expect(before.pages[0].widgets[0].config).toEqual({ timezones: ["UTC"] });
  });
});
