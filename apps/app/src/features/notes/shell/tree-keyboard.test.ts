import { describe, expect, it } from "@rstest/core";

import { treeKeyAction, type TreeRow } from "./tree-keyboard";

// pages:a (expanded) ─ pages:a1 (leaf)
//                    └ pages:a2 (collapsed, has children)
// pages:b (leaf)
const rows: TreeRow[] = [
  { key: "pages:a", id: "a", parentKey: null, expandable: true, expanded: true },
  { key: "pages:a1", id: "a1", parentKey: "pages:a", expandable: false, expanded: false },
  { key: "pages:a2", id: "a2", parentKey: "pages:a", expandable: true, expanded: false },
  { key: "pages:b", id: "b", parentKey: null, expandable: false, expanded: false },
];
const edit = { canEdit: true };
const press = (focused: string | null, key: string, mods: Record<string, boolean> = {}) =>
  treeKeyAction(rows, focused, { key, ...mods }, edit);

describe("tree keys — sidebar keyboard (NR-2, AC4)", () => {
  it("moves between visible rows with ↑ / ↓ and stops at the ends", () => {
    expect(press("pages:a", "ArrowDown")).toEqual({ type: "focus", key: "pages:a1" });
    expect(press("pages:a1", "ArrowUp")).toEqual({ type: "focus", key: "pages:a" });
    expect(press("pages:b", "ArrowDown")).toBeNull();
    expect(press("pages:a", "ArrowUp")).toBeNull();
    expect(press(null, "ArrowDown")).toEqual({ type: "focus", key: "pages:a" });
    expect(press("pages:a2", "Home")).toEqual({ type: "focus", key: "pages:a" });
    expect(press("pages:a", "End")).toEqual({ type: "focus", key: "pages:b" });
  });

  it("→ expands a collapsed row, steps into an expanded one, and is inert on a leaf", () => {
    expect(press("pages:a2", "ArrowRight")).toEqual({ type: "expand", key: "pages:a2" });
    expect(press("pages:a", "ArrowRight")).toEqual({ type: "focus", key: "pages:a1" });
    expect(press("pages:b", "ArrowRight")).toBeNull();
  });

  it("← collapses an expanded row, steps out of a child, and is inert on a root leaf", () => {
    expect(press("pages:a", "ArrowLeft")).toEqual({ type: "collapse", key: "pages:a" });
    expect(press("pages:a1", "ArrowLeft")).toEqual({ type: "focus", key: "pages:a" });
    expect(press("pages:a2", "ArrowLeft")).toEqual({ type: "focus", key: "pages:a" });
    expect(press("pages:b", "ArrowLeft")).toBeNull();
  });

  it("↵ opens and ⌫ trashes the focused note", () => {
    expect(press("pages:a1", "Enter")).toEqual({ type: "open", id: "a1" });
    expect(press("pages:a1", "Backspace")).toEqual({ type: "trash", id: "a1" });
    expect(press("pages:a1", "Delete")).toEqual({ type: "trash", id: "a1" });
  });

  it("⌥⇧↑ / ⌥⇧↓ reorder the focused row", () => {
    expect(press("pages:a2", "ArrowUp", { altKey: true, shiftKey: true })).toEqual({
      type: "reorder",
      key: "pages:a2",
      direction: "up",
    });
    expect(press("pages:a", "ArrowDown", { altKey: true, shiftKey: true })).toEqual({
      type: "reorder",
      key: "pages:a",
      direction: "down",
    });
  });

  it("view-only: no trash and no reorder, navigation still works", () => {
    const view = { canEdit: false };
    expect(treeKeyAction(rows, "pages:a1", { key: "Backspace" }, view)).toBeNull();
    expect(
      treeKeyAction(rows, "pages:a1", { key: "ArrowUp", altKey: true, shiftKey: true }, view),
    ).toBeNull();
    expect(treeKeyAction(rows, "pages:a1", { key: "ArrowUp" }, view)).toEqual({
      type: "focus",
      key: "pages:a",
    });
  });

  it("⇧F10, the menu key and ⌥↵ open the focused row's menu, for viewers too", () => {
    const menu = { type: "menu", key: "pages:a1" };
    expect(press("pages:a1", "F10", { shiftKey: true })).toEqual(menu);
    expect(press("pages:a1", "ContextMenu")).toEqual(menu);
    expect(press("pages:a1", "Enter", { altKey: true })).toEqual(menu);
    expect(treeKeyAction(rows, "pages:a1", { key: "ContextMenu" }, { canEdit: false })).toEqual(
      menu,
    );
    expect(press("pages:a1", "F10")).toBeNull();
    expect(press(null, "ContextMenu")).toBeNull();
  });

  it("leaves ⌘-chords and plain letters to the rest of the app", () => {
    expect(press("pages:a", "ArrowDown", { metaKey: true })).toBeNull();
    expect(press("pages:a", "n", { metaKey: true })).toBeNull();
    expect(press("pages:a", "x")).toBeNull();
  });
});
