// TV-U11 — the Board's keys: the List's map with the arrows sideways (←→ to
// the next column, ⌥⇧←/→ moves the card there), and the cursor's walk.

import { describe, expect, it } from "@rstest/core";
import { boardKeyAction, moveInGrid } from "./board-keys";

const key = (
  k: string,
  mods: Partial<Record<"meta" | "ctrl" | "alt" | "shift", boolean>> = {},
) => ({
  key: k,
  metaKey: !!mods.meta,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
});

describe("boardKeyAction", () => {
  it("↑↓ and j/k walk a column; ←→ go to the next column", () => {
    expect(boardKeyAction(key("ArrowDown"))).toBe("next");
    expect(boardKeyAction(key("k"))).toBe("prev");
    expect(boardKeyAction(key("ArrowLeft"))).toBe("left");
    expect(boardKeyAction(key("ArrowRight"))).toBe("right");
  });

  it("⌥⇧ arrows move the card: up/down in its column, left/right to the next column", () => {
    expect(boardKeyAction(key("ArrowUp", { alt: true, shift: true }))).toBe("move-up");
    expect(boardKeyAction(key("ArrowDown", { alt: true, shift: true }))).toBe("move-down");
    expect(boardKeyAction(key("ArrowLeft", { alt: true, shift: true }))).toBe("move-left");
    expect(boardKeyAction(key("ArrowRight", { alt: true, shift: true }))).toBe("move-right");
  });

  it("⏎ opens, e edits, Space finishes, ⇧S status, c adds; nesting stays the List's", () => {
    expect(boardKeyAction(key("Enter"))).toBe("open");
    expect(boardKeyAction(key("e"))).toBe("edit");
    expect(boardKeyAction(key(" "))).toBe("toggle-done");
    expect(boardKeyAction(key("S", { shift: true }))).toBe("status");
    expect(boardKeyAction(key("c"))).toBe("capture");
    expect(boardKeyAction(key(">"))).toBeNull();
    expect(boardKeyAction(key("<"))).toBeNull();
  });

  it("leaves the app's and the OS's shortcuts alone, and a card control's Space", () => {
    expect(boardKeyAction(key("k", { meta: true }))).toBeNull();
    expect(boardKeyAction(key("ArrowLeft", { alt: true }))).toBeNull();
    expect(boardKeyAction(key(" "), { onControl: true })).toBeNull();
  });
});

describe("moveInGrid", () => {
  const grid = [
    { id: "todo", ids: ["a", "b", "c"] },
    { id: "doing", ids: [] },
    { id: "done", ids: ["x", "y"] },
  ];

  it("starts at the first card when nothing on the board is selected", () => {
    expect(moveInGrid(grid, null, "down")).toBe("a");
    expect(moveInGrid(grid, "gone", "right")).toBe("a");
  });

  it("walks within a column and stops at its ends", () => {
    expect(moveInGrid(grid, "a", "down")).toBe("b");
    expect(moveInGrid(grid, "b", "up")).toBe("a");
    expect(moveInGrid(grid, "a", "up")).toBeNull();
    expect(moveInGrid(grid, "c", "down")).toBeNull();
  });

  it("goes sideways to the nearest place, over empty columns", () => {
    expect(moveInGrid(grid, "c", "right")).toBe("y");
    expect(moveInGrid(grid, "a", "right")).toBe("x");
    expect(moveInGrid(grid, "y", "left")).toBe("b");
    expect(moveInGrid(grid, "a", "left")).toBeNull();
  });
});
