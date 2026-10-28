// AC22 (CALR-4): every Calendar key works "as the keys sheet says", so the
// sheet is read from the registry: each calendar binding has a row, with the
// keys the registry binds (⌘← / ⌘→ for the period; bare arrows are the cursor).

import { describe, expect, it } from "@rstest/core";

import { HOTKEYS } from "../../lib/hotkeys/registry";
import { calendarKeyRows } from "./keys-sheet";

const calendarIds = Object.entries(HOTKEYS)
  .filter(([, def]) => def.scope === "calendar")
  .map(([id]) => id);

describe("calendarKeyRows", () => {
  it("lists every Calendar binding in the registry", () => {
    const listed = new Set(calendarKeyRows(true).flatMap((row) => row.ids));
    for (const id of calendarIds) expect(listed.has(id)).toBe(true);
  });

  it("says the keys as the platform shows them", () => {
    const mac = calendarKeyRows(true);
    const period = mac.find((row) => row.ids.includes("calendar.prev"));
    expect(period?.keys).toEqual(["⌘←", "⌘→"]);
    const undo = mac.find((row) => row.ids.includes("calendar.undo"));
    expect(undo?.keys).toEqual(["⌘Z"]);
    const other = calendarKeyRows(false).find((row) => row.ids.includes("calendar.undo"));
    expect(other?.keys).toEqual(["Ctrl Z"]);
  });

  it("groups rows by where they work", () => {
    const groups = new Set(calendarKeyRows(true).map((row) => row.group));
    expect([...groups]).toEqual(["Anywhere in Calendar", "The grid", "An event"]);
  });
});
