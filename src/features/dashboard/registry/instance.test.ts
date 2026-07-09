// DB-8 — the gallery's widget-instance factory seeds the type's default size +
// config and a fresh id (the engine assigns x/y on placement).

import { describe, expect, it } from "vitest";

import { defaultConfigFor, defaultSizeFor } from "./catalog";
import { newWidgetInstance } from "./instance";

describe("newWidgetInstance", () => {
  it("seeds the type's default size + config when no size is given", () => {
    const w = newWidgetInstance("pomodoro");
    expect(w.type).toBe("pomodoro");
    expect(w.size).toBe(defaultSizeFor("pomodoro"));
    expect(w.config).toEqual(defaultConfigFor("pomodoro"));
    expect(w.x).toBe(0);
    expect(w.y).toBe(0);
    expect(typeof w.id).toBe("string");
    expect(w.id.length).toBeGreaterThan(0);
  });

  it("uses the requested size", () => {
    expect(newWidgetInstance("tasks", "L").size).toBe("L");
  });

  it("gives each instance a distinct id + its own config object", () => {
    const a = newWidgetInstance("clock");
    const b = newWidgetInstance("clock");
    expect(a.id).not.toBe(b.id);
    expect(a.config).not.toBe(b.config); // defaultConfigFor returns a fresh copy
  });
});
