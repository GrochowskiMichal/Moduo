import { describe, expect, it } from "@rstest/core";

import { isPastedList, keepAsOne, PASTE_CAP, parsePastedList } from "./paste-list";

describe("a pasted list (AC10.8)", () => {
  it("two or more lines with words make a list; one line doesn't", () => {
    expect(isPastedList("Buy milk")).toBe(false);
    expect(isPastedList("Buy milk\n\n")).toBe(false);
    expect(isPastedList("Buy milk\nCall Mo")).toBe(true);
  });

  it("strips bullets, numbers and boxes; skips done lines and blanks", () => {
    const list = parsePastedList(
      "- Buy milk\n\n2. Call Mo\n* [ ] Book flights\n[x] Pay rent\n• Pack",
    );
    expect(list.items.map((i) => i.title)).toEqual(["Buy milk", "Call Mo", "Book flights", "Pack"]);
    expect(list.skippedDone).toBe(1);
    expect(list.count).toBe(4);
  });

  it("indented lines become subtasks of the line above; deeper levels flatten", () => {
    const list = parsePastedList("Launch\n  Write copy\n    Proofread\n\tShip\nRetro\n  Notes");
    expect(list.items).toEqual([
      { title: "Launch", children: ["Write copy", "Proofread", "Ship"] },
      { title: "Retro", children: ["Notes"] },
    ]);
    expect(list.count).toBe(6);
  });

  it("caps at 500 tasks and counts the rest", () => {
    const text = Array.from({ length: 612 }, (_, i) => `Task ${i + 1}`).join("\n");
    const list = parsePastedList(text);
    expect(list.count).toBe(PASTE_CAP);
    expect(list.items).toHaveLength(500);
    expect(list.overCap).toBe(112);
  });

  it("a parent past the cap takes its subtasks with it", () => {
    const list = parsePastedList("A\nB\n  b1\n  b2", 1);
    expect(list.items).toEqual([{ title: "A", children: [] }]);
    expect(list.overCap).toBe(3);
  });

  it("a done parent's subtasks stand on their own", () => {
    const list = parsePastedList("[x] Done thing\n  Follow-up\nNext");
    expect(list.items.map((i) => i.title)).toEqual(["Follow-up", "Next"]);
    expect(list.skippedDone).toBe(1);
  });

  it("Keep as one: the first line is the title, the rest the description", () => {
    expect(keepAsOne("\n- Plan trip\nbook flights\nhotel\n")).toEqual({
      title: "Plan trip",
      description: "book flights\nhotel",
    });
  });
});
