// TV-TL1 · the Timeline's keys (keymap.md "Timeline", REPLAN 70): ↑↓ · j k
// move, ← → fold, ⏎ open, Space complete, t today, bare − = zoom, ⇧[ the
// name column, Esc clear; modified keys and TV-TL2's keys fall through.

import { describe, expect, it } from "@rstest/core";

import { isTypingTarget, timelineKeyAction } from "./timeline-keys";

const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
  key: k,
  code: mods.code ?? "",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("timelineKeyAction", () => {
  it("moves, folds, opens, completes", () => {
    expect(timelineKeyAction(key("ArrowDown"))).toBe("next");
    expect(timelineKeyAction(key("j"))).toBe("next");
    expect(timelineKeyAction(key("k"))).toBe("prev");
    expect(timelineKeyAction(key("ArrowLeft"))).toBe("fold");
    expect(timelineKeyAction(key("ArrowRight"))).toBe("unfold");
    expect(timelineKeyAction(key("Enter"))).toBe("open");
    expect(timelineKeyAction(key(" "))).toBe("toggle");
    expect(timelineKeyAction(key("Escape"))).toBe("clear");
  });

  it("t is today; bare − and = zoom; ⇧[ hides the name column", () => {
    expect(timelineKeyAction(key("t"))).toBe("today");
    expect(timelineKeyAction(key("-"))).toBe("zoom-out");
    expect(timelineKeyAction(key("="))).toBe("zoom-in");
    expect(timelineKeyAction(key("{", { shiftKey: true, code: "BracketLeft" }))).toBe(
      "name-column",
    );
  });

  it("leaves modified keys to the app and TV-TL2's keys alone", () => {
    expect(timelineKeyAction(key("=", { metaKey: true }))).toBeNull();
    expect(timelineKeyAction(key("ArrowRight", { altKey: true }))).toBeNull();
    expect(timelineKeyAction(key("ArrowDown", { shiftKey: true }))).toBeNull();
    expect(timelineKeyAction(key("T", { shiftKey: true }))).toBeNull();
    expect(timelineKeyAction(key("d"))).toBeNull();
  });

  it("knows a field keeps its own keys", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("div"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
