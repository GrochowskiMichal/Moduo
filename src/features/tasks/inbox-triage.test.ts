// TV-U15 · the Inbox's triage rules (AC3.3's unit half; the keys end to end
// are tests/inbox.spec.ts): the four keys, snoozes that come back on their
// day or with a comment, Decline's two ways, the source words and the
// Duplicate's copied comments.

import { describe, expect, it } from "@rstest/core";

import {
  declineComment,
  declineMode,
  duplicateComment,
  inboxSourceLabel,
  snoozeChoices,
  snoozedUntilLabel,
  splitSnoozed,
  triageActionFor,
} from "./inbox-triage";

const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...mods,
});

describe("Inbox triage", () => {
  it("1 · 2 · 3 · H, never with a modifier", () => {
    expect(triageActionFor(key("1"))).toBe("accept");
    expect(triageActionFor(key("2"))).toBe("decline");
    expect(triageActionFor(key("3"))).toBe("duplicate");
    expect(triageActionFor(key("h"))).toBe("snooze");
    expect(triageActionFor(key("H"))).toBe("snooze");
    // ⌘1 switches modules; ⌥1 is the OS's.
    expect(triageActionFor(key("1", { metaKey: true }))).toBeNull();
    expect(triageActionFor(key("2", { altKey: true }))).toBeNull();
    expect(triageActionFor(key("4"))).toBeNull();
  });

  it("a snooze holds until its day or a new comment; one whose task left is stale", () => {
    const tasks = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const split = splitSnoozed(
      tasks,
      {
        a: { until: "2026-10-20", stamp: null },
        b: { until: "2026-10-14", stamp: null },
        c: { until: "2026-10-20", stamp: "t1#1" },
        gone: { until: "2026-10-20", stamp: null },
      },
      "2026-10-14",
      new Map([["c", "t2#2"]]),
    );
    expect(split.snoozed.map((t) => t.id)).toEqual(["a"]);
    // b's day came; c got a comment since.
    expect(split.woken).toEqual(["b", "c"]);
    expect(split.active.map((t) => t.id)).toEqual(["b", "c", "d"]);
    expect(split.stale).toEqual(["gone"]);
  });

  it("snoozes until tomorrow or next Monday", () => {
    // Wednesday, Oct 14 2026.
    const now = new Date(2026, 9, 14, 10);
    expect(snoozeChoices(now)).toEqual([
      { label: "Tomorrow", until: "2026-10-15" },
      { label: "Next week", until: "2026-10-19" },
    ]);
    // On a Sunday, next week is tomorrow: one choice.
    expect(snoozeChoices(new Date(2026, 9, 18, 10))).toEqual([
      { label: "Tomorrow", until: "2026-10-19" },
    ]);
    expect(snoozedUntilLabel("2026-10-15", now)).toBe("until Tomorrow");
  });

  it("Decline hands someone else's task back with a note; your own becomes Won't do", () => {
    expect(declineMode({ creatorId: "mike", creatorUnknown: false }, "me")).toBe("hand-back");
    expect(declineMode({ creatorId: "me", creatorUnknown: false }, "me")).toBe("wont-do");
    expect(declineMode({ creatorId: "mike", creatorUnknown: true }, "me")).toBe("wont-do");
    expect(declineComment("Maciej", "  not mine ")).toBe("Declined by Maciej: not mine");
    expect(declineComment("Maciej", "")).toBe("Declined by Maciej.");
  });

  it("a task someone else made reads “from Mike”; your own says nothing", () => {
    const first = (id: string) => (id === "mike" ? "Mike" : null);
    expect(inboxSourceLabel({ creatorId: "mike", creatorUnknown: false }, "me", first)).toBe(
      "from Mike",
    );
    expect(inboxSourceLabel({ creatorId: "me", creatorUnknown: false }, "me", first)).toBeNull();
  });

  it("Duplicate copies the duplicate's comments, with who wrote each", () => {
    expect(
      duplicateComment("Fix login", [
        { author: "Anna", body: "Seen on Safari" },
        { author: "Mike", body: "  " },
      ]),
    ).toBe("Merged “Fix login” into this task.\n\nAnna: Seen on Safari");
    expect(duplicateComment("", [])).toBe("Merged “Untitled” into this task.");
  });
});
