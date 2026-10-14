// TV-U12 · the selection model (tasks-v3 §4, call 82b): ⌘-click adds and
// removes, ⇧-click and ⇧↑↓ select a range in the view's order, ⌘A selects the
// view, one left is the cursor again, and tasks that leave are dropped.

import { describe, expect, it } from "@rstest/core";

import {
  extendSelection,
  inViewOrder,
  isMulti,
  NO_SELECTION,
  PLAIN_SELECT,
  pruneSelection,
  selectAll,
  selectModsOf,
  selectWith,
} from "./selection";

const ORDER = ["a", "b", "c", "d", "e"];
const TOGGLE = { range: false, toggle: true };
const RANGE = { range: true, toggle: false };

describe("the selection model (AC11.9)", () => {
  it("a click selects one task: the cursor, no set", () => {
    const r = selectWith(NO_SELECTION, "a", "c", PLAIN_SELECT, ORDER);
    expect(r.cursor).toBe("c");
    expect(isMulti(r.selection)).toBe(false);
  });

  it("⌘-click starts from the cursor, adds, and takes one out", () => {
    const two = selectWith(NO_SELECTION, "a", "c", TOGGLE, ORDER);
    expect([...two.selection.ids].sort()).toEqual(["a", "c"]);
    expect(two.cursor).toBe("c");
    const three = selectWith(two.selection, two.cursor, "e", TOGGLE, ORDER);
    expect(three.selection.ids.size).toBe(3);
    const back = selectWith(three.selection, three.cursor, "e", TOGGLE, ORDER);
    expect([...back.selection.ids].sort()).toEqual(["a", "c"]);
    expect(back.cursor).toBe("c");
  });

  it("taking the second-last one out leaves the other as the cursor", () => {
    const two = selectWith(NO_SELECTION, "a", "c", TOGGLE, ORDER);
    const one = selectWith(two.selection, two.cursor, "c", TOGGLE, ORDER);
    expect(isMulti(one.selection)).toBe(false);
    expect(one.cursor).toBe("a");
  });

  it("⇧-click selects the range from the cursor, in the view's order, either way", () => {
    const down = selectWith(NO_SELECTION, "b", "d", RANGE, ORDER);
    expect(inViewOrder(down.selection.ids, ORDER)).toEqual(["b", "c", "d"]);
    expect(down.cursor).toBe("d");
    // A second ⇧-click re-draws the range from the same anchor.
    const up = selectWith(down.selection, down.cursor, "a", RANGE, ORDER);
    expect(inViewOrder(up.selection.ids, ORDER)).toEqual(["a", "b"]);
  });

  it("⇧↓ and ⇧↑ grow and shrink the range from the anchor", () => {
    const one = extendSelection(NO_SELECTION, "b", 1, ORDER);
    expect(inViewOrder(one?.selection.ids ?? new Set(), ORDER)).toEqual(["b", "c"]);
    const two = extendSelection(one?.selection ?? NO_SELECTION, one?.cursor ?? null, 1, ORDER);
    expect(inViewOrder(two?.selection.ids ?? new Set(), ORDER)).toEqual(["b", "c", "d"]);
    const back = extendSelection(two?.selection ?? NO_SELECTION, two?.cursor ?? null, -1, ORDER);
    expect(inViewOrder(back?.selection.ids ?? new Set(), ORDER)).toEqual(["b", "c"]);
    expect(extendSelection(NO_SELECTION, "e", 1, ORDER)).toBeNull();
  });

  it("⌘A selects every task the view shows and keeps the cursor", () => {
    const all = selectAll("c", ORDER);
    expect(all?.selection.ids.size).toBe(5);
    expect(all?.cursor).toBe("c");
    expect(selectAll("a", ["a"])).toBeNull();
  });

  it("a task that leaves is dropped; one left is the cursor again", () => {
    const all = selectAll("c", ORDER);
    const kept = pruneSelection(all?.selection ?? NO_SELECTION, "c", (id) => id !== "e", ORDER);
    expect(kept?.selection.ids.size).toBe(4);
    const one = pruneSelection(kept?.selection ?? NO_SELECTION, "c", (id) => id === "a", ORDER);
    expect(isMulti(one?.selection ?? NO_SELECTION)).toBe(false);
    expect(one?.cursor).toBe("a");
    expect(pruneSelection(NO_SELECTION, "a", () => false)).toBeNull();
  });

  it("a selection keeps off-screen tasks (the view's order only sorts them)", () => {
    expect(inViewOrder(new Set(["z", "b", "a"]), ORDER)).toEqual(["a", "b", "z"]);
  });

  it("reads ⌘ or Ctrl as one more, ⇧ as a range", () => {
    expect(selectModsOf({ shiftKey: false, metaKey: false, ctrlKey: true }).toggle).toBe(true);
    expect(selectModsOf({ shiftKey: true, metaKey: false, ctrlKey: false }).range).toBe(true);
  });
});
