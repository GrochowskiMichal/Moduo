// SH-1 (tasks-v3 calls 72a, 89; AC11.7) — the right-panel view registry: every
// module lists a few hand-picked views, *about this* before *alongside*, and ⌥
// plus the menu position picks one.
import { describe, expect, it } from "@rstest/core";

import {
  MAX_PANEL_VIEWS,
  orderedPanelViews,
  PANEL_VIEWS,
  type PanelModule,
  type PanelViewDef,
  panelShortcutLabel,
  panelShortcutNumber,
  panelViewsFor,
} from "./panel-registry";

const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);
const noIcon = (() => null) as unknown as PanelViewDef["icon"];

describe("the registered views", () => {
  it("covers the five modules that have a right panel, with their old tabs' ids", () => {
    const ids = (m: PanelModule) => PANEL_VIEWS[m].map((v) => v.id).sort();
    expect(ids("tasks")).toEqual(["details"]);
    expect(ids("calendar")).toEqual(["detail", "notes", "tasks"]);
    expect(ids("email")).toEqual(["contact", "detail", "reader", "task"]);
    expect(ids("notes")).toEqual(["comments", "detail", "outline"]);
    expect(ids("contacts")).toEqual(["notes"]);
  });

  it("keeps each module's list short, unique and labelled", () => {
    for (const [module, views] of Object.entries(PANEL_VIEWS)) {
      expect(views.length, module).toBeGreaterThan(0);
      expect(views.length, module).toBeLessThanOrEqual(MAX_PANEL_VIEWS);
      expect(new Set(views.map((v) => v.id)).size, module).toBe(views.length);
      for (const view of views) {
        expect(view.label, `${module}.${view.id}`).toMatch(/^[A-Z][a-z ]*$/);
        expect(view.icon, `${module}.${view.id}`).toBeTruthy();
      }
    }
  });

  it("calls Tasks' first view Details", () => {
    expect(panelViewsFor("tasks")[0]).toMatchObject({ id: "details", label: "Details" });
  });
});

describe("menu order", () => {
  it("puts about-this views first and keeps registration order inside each group", () => {
    const views: PanelViewDef[] = [
      { id: "flight", label: "In flight", group: "alongside", icon: noIcon },
      { id: "details", label: "Details", group: "about", icon: noIcon },
      { id: "nodate", label: "No date", group: "alongside", icon: noIcon },
      { id: "project", label: "Project", group: "about", icon: noIcon },
    ];
    expect(orderedPanelViews(views).map((v) => v.id)).toEqual([
      "details",
      "project",
      "flight",
      "nodate",
    ]);
  });

  it("lists Calendar's Tasks below its about-this views", () => {
    expect(panelViewsFor("calendar").map((v) => v.id)).toEqual(["detail", "notes", "tasks"]);
  });

  it("leaves out the views a page can't render", () => {
    expect(panelViewsFor("email", (id) => id !== "task").map((v) => v.id)).toEqual([
      "reader",
      "contact",
      "detail",
    ]);
  });
});

describe("⌥ shortcuts", () => {
  it("reads the digit from the key's code, since macOS types ¡ ™ £ for ⌥1 ⌥2 ⌥3", () => {
    expect(panelShortcutNumber(key({ altKey: true, code: "Digit1", key: "¡" }))).toBe(1);
    expect(panelShortcutNumber(key({ altKey: true, code: "Digit4", key: "¢" }))).toBe(4);
  });

  it("ignores ⌘, Ctrl and ⇧ combos, plain digits and other keys", () => {
    expect(panelShortcutNumber(key({ code: "Digit1", key: "1" }))).toBeNull();
    expect(panelShortcutNumber(key({ altKey: true, metaKey: true, code: "Digit1" }))).toBeNull();
    expect(panelShortcutNumber(key({ altKey: true, ctrlKey: true, code: "Digit1" }))).toBeNull();
    expect(panelShortcutNumber(key({ altKey: true, shiftKey: true, code: "Digit1" }))).toBeNull();
    expect(panelShortcutNumber(key({ altKey: true, code: "Digit0" }))).toBeNull();
    expect(panelShortcutNumber(key({ altKey: true, code: "KeyA" }))).toBeNull();
  });

  it("labels the hint per platform", () => {
    expect(panelShortcutLabel(0, true)).toBe("⌥1");
    expect(panelShortcutLabel(2, false)).toBe("Alt 3");
  });
});
