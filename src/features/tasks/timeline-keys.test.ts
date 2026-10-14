// TV-TL1 · the Timeline's keys (keymap.md "Timeline", REPLAN 70): ↑↓ · j k
// move, ← → fold, ⏎ open, Space complete, t today, bare − = zoom, ⇧[ the
// name column, Esc clear; TV-TL2's ⌥←/→ (⇧ a week), d · ⇧D, ⇧T, ⇧↑↓, ⌘A.

import { describe, expect, it } from "@rstest/core";

import { isTypingTarget, shiftDaysOf, timelineKeyAction } from "./timeline-keys";

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

  it("leaves other modified keys to the app", () => {
    expect(timelineKeyAction(key("=", { metaKey: true }))).toBeNull();
    expect(timelineKeyAction(key("ArrowDown", { altKey: true }))).toBeNull();
    expect(timelineKeyAction(key("a", { metaKey: true, shiftKey: true }))).toBeNull();
    expect(timelineKeyAction(key("J", { shiftKey: true }))).toBeNull();
  });

  it("TV-TL2: ⌥ arrows move a date, d · ⇧D, ⇧T fits, ⇧↑↓ extend, ⌘A", () => {
    expect(timelineKeyAction(key("ArrowRight", { altKey: true }))).toBe("shift-later");
    expect(timelineKeyAction(key("ArrowLeft", { altKey: true }))).toBe("shift-earlier");
    expect(timelineKeyAction(key("ArrowRight", { altKey: true, shiftKey: true }))).toBe(
      "shift-later-week",
    );
    expect(timelineKeyAction(key("ArrowLeft", { altKey: true, shiftKey: true }))).toBe(
      "shift-earlier-week",
    );
    expect(shiftDaysOf("shift-later")).toBe(1);
    expect(shiftDaysOf("shift-earlier-week")).toBe(-7);
    expect(shiftDaysOf("today")).toBe(0);
    expect(timelineKeyAction(key("d"))).toBe("date");
    expect(timelineKeyAction(key("D", { shiftKey: true }))).toBe("clear-date");
    expect(timelineKeyAction(key("T", { shiftKey: true }))).toBe("fit");
    expect(timelineKeyAction(key("ArrowDown", { shiftKey: true }))).toBe("extend-next");
    expect(timelineKeyAction(key("ArrowUp", { shiftKey: true }))).toBe("extend-prev");
    expect(timelineKeyAction(key("a", { metaKey: true }))).toBe("select-all");
    expect(timelineKeyAction(key("a", { ctrlKey: true }))).toBe("select-all");
  });

  it("⇧L opens a late task's mark; a bare l stays free (the rows' tags)", () => {
    expect(timelineKeyAction(key("L", { shiftKey: true }))).toBe("late");
    expect(timelineKeyAction(key("l"))).toBeNull();
  });

  it("knows a field keeps its own keys", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("div"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
