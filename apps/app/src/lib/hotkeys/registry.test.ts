// AC8 (specs/tanstack-spine.md): a duplicate binding inside one scope fails here,
// and so does a narrower scope hiding a wider one's key without `overrides`.
import { describe, expect, it } from "@rstest/core";

import {
  findDuplicateBindings,
  findUndeclaredShadows,
  HOTKEYS,
  type HotkeyRegistry,
  keysFor,
} from "./registry";

describe("the hotkey registry", () => {
  it("has no duplicate binding inside a scope", () => {
    expect(findDuplicateBindings(HOTKEYS)).toEqual([]);
  });

  it("declares every key a narrower scope takes from a wider one", () => {
    expect(findUndeclaredShadows(HOTKEYS)).toEqual([]);
  });

  it("catches two bindings on one key in one scope, including Mod spelled out", () => {
    const bad: HotkeyRegistry = {
      a: { scope: "global", label: "A", keys: ["Mod+K"] },
      b: { scope: "global", label: "B", keys: ["Meta+K"] },
      c: { scope: "tasks", label: "C", keys: ["Mod+K"], overrides: true },
    };
    expect(findDuplicateBindings(bad)).toEqual(['a and b both bind Mod+K in "global"']);
  });

  it("catches one binding listing a key twice", () => {
    const bad: HotkeyRegistry = { a: { scope: "home", label: "A", keys: ["J", "J"] } };
    expect(findDuplicateBindings(bad)).toEqual(["a lists J twice"]);
  });

  it("catches a platform-only duplicate", () => {
    const bad: HotkeyRegistry = {
      a: { scope: "global", label: "A", keys: [{ key: "F11", only: "other" }] },
      b: { scope: "global", label: "B", keys: ["F11"] },
    };
    expect(findDuplicateBindings(bad)).toHaveLength(1);
  });

  it("requires overrides when a route or surface reuses a wider key", () => {
    const bad: HotkeyRegistry = {
      help: { scope: "global", label: "Help", keys: ["Shift+/"] },
      list: { scope: "tasks", label: "Close", keys: ["Escape"] },
      page: { scope: "task-page", label: "Close", keys: ["Escape"] },
      legend: { scope: "email", label: "Legend", keys: ["Shift+/"] },
    };
    expect(findUndeclaredShadows(bad)).toEqual([
      "page shadows list on Escape without overrides: true",
      "legend shadows help on Shift+/ without overrides: true",
    ]);
  });

  it("keeps the platform-only keys apart", () => {
    expect(keysFor(HOTKEYS.fullscreen, true)).toEqual(["Control+Meta+F"]);
    expect(keysFor(HOTKEYS.fullscreen, false)).toEqual(["F11"]);
  });
});
