// AC3: the all-day lane shows at most two rows; a multi-day item is one bar
// with its length ("2 days"); each day with items that don't fit says how many
// ("+N more"); expanded (⇧A) shows every row and hides nothing.

import { describe, expect, it } from "@rstest/core";

import { ALL_DAY_MAX_ROWS, layoutAllDayLane } from "./allday-lane";
import type { EventChip } from "./events";
import { addDays, localDayKey } from "./lens";

// Mon 26 Oct – Sun 1 Nov 2026.
const monday = new Date(2026, 9, 26);
const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
const dayKeys = days.map(localDayKey);

type Spec = { id: string; from: number; to: number; title?: string };

/** One all-day occurrence covering day indexes [from, to] (inclusive; may
 * reach outside the week), as eventChipsInRange hands it out: one piece per
 * visible day, all sharing the occurrence key. */
function lane(specs: Spec[]): Map<string, EventChip[]> {
  const out = new Map<string, EventChip[]>();
  for (const s of specs) {
    const startMs = addDays(monday, s.from).getTime();
    const endMs = addDays(monday, s.to + 1).getTime();
    for (let i = Math.max(0, s.from); i <= Math.min(6, s.to); i++) {
      const dayKey = dayKeys[i];
      const chip: EventChip = {
        eventId: s.id,
        occurrenceKey: `${s.id}:${startMs}`,
        title: s.title ?? s.id,
        startMs,
        endMs,
        dayKey,
        allDay: true,
        external: false,
        readOnly: false,
        recurring: false,
        sourceAccountId: null,
        color: null,
        continuesFromMs: null,
        continuesToMs: null,
        locked: false,
      };
      out.set(dayKey, [...(out.get(dayKey) ?? []), chip]);
    }
  }
  return out;
}

describe("two rows, spans, +N per day", () => {
  it("caps the lane at two rows", () => {
    expect(ALL_DAY_MAX_ROWS).toBe(2);
  });

  it("two items on a day fit: both show, nothing is hidden", () => {
    const out = layoutAllDayLane(
      dayKeys,
      lane([
        { id: "a", from: 1, to: 1 },
        { id: "b", from: 1, to: 1 },
      ]),
    );
    expect(out.rows).toBe(2);
    expect(out.bars).toHaveLength(2);
    expect(out.overflows).toBe(false);
    expect(out.hiddenByDay).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("more than two rows: one row of bars, then +N per day in the second", () => {
    const out = layoutAllDayLane(
      dayKeys,
      lane([
        { id: "a", from: 1, to: 1 },
        { id: "b", from: 1, to: 1 },
        { id: "c", from: 1, to: 1 },
        { id: "d", from: 1, to: 1 },
      ]),
    );
    expect(out.rows).toBe(ALL_DAY_MAX_ROWS);
    expect(out.overflows).toBe(true);
    expect(out.totalRows).toBe(4);
    expect(out.bars).toHaveLength(1);
    expect(out.bars.every((b) => b.row === 0)).toBe(true);
    expect(out.hiddenByDay).toEqual([0, 3, 0, 0, 0, 0, 0]);
  });

  it("a multi-day item is one bar with its length", () => {
    const out = layoutAllDayLane(dayKeys, lane([{ id: "trip", from: 1, to: 2 }]));
    expect(out.bars).toHaveLength(1);
    const [bar] = out.bars;
    expect(bar.startCol).toBe(1);
    expect(bar.span).toBe(2);
    expect(bar.lengthLabel).toBe("2 days");
    expect(bar.continuesBefore).toBe(false);
    expect(bar.continuesAfter).toBe(false);
  });

  it("a one-day item carries no length", () => {
    const out = layoutAllDayLane(dayKeys, lane([{ id: "x", from: 3, to: 3 }]));
    expect(out.bars[0].span).toBe(1);
    expect(out.bars[0].lengthLabel).toBeNull();
  });

  it("an item reaching outside the week is clipped to it and keeps its whole length", () => {
    const out = layoutAllDayLane(
      dayKeys,
      lane([
        { id: "before", from: -2, to: 1 },
        { id: "after", from: 5, to: 8 },
      ]),
    );
    const before = out.bars.find((b) => b.chip.eventId === "before")!;
    expect(before.startCol).toBe(0);
    expect(before.span).toBe(2);
    expect(before.continuesBefore).toBe(true);
    expect(before.continuesAfter).toBe(false);
    expect(before.lengthLabel).toBe("4 days");
    const after = out.bars.find((b) => b.chip.eventId === "after")!;
    expect(after.startCol).toBe(5);
    expect(after.span).toBe(2);
    expect(after.continuesAfter).toBe(true);
    expect(after.lengthLabel).toBe("4 days");
  });

  it("items that don't overlap share a row", () => {
    const out = layoutAllDayLane(
      dayKeys,
      lane([
        { id: "a", from: 0, to: 1 },
        { id: "b", from: 2, to: 2 },
        { id: "c", from: 4, to: 6 },
      ]),
    );
    expect(out.totalRows).toBe(1);
    expect(out.rows).toBe(1);
    expect(out.bars.map((b) => b.row)).toEqual([0, 0, 0]);
  });

  it("the hidden count per day counts each item that doesn't show on that day", () => {
    // Row 0: a (Mon–Wed). Tue holds b and c, Wed holds d: three rows in all.
    const out = layoutAllDayLane(
      dayKeys,
      lane([
        { id: "a", from: 0, to: 2 },
        { id: "b", from: 1, to: 1 },
        { id: "c", from: 1, to: 1 },
        { id: "d", from: 2, to: 2 },
      ]),
    );
    expect(out.totalRows).toBe(3);
    expect(out.bars.map((b) => b.chip.eventId)).toEqual(["a"]);
    expect(out.hiddenByDay).toEqual([0, 2, 1, 0, 0, 0, 0]);
  });

  it("expanded shows every row and hides nothing", () => {
    const specs = [
      { id: "a", from: 0, to: 2 },
      { id: "b", from: 1, to: 1 },
      { id: "c", from: 1, to: 1 },
      { id: "d", from: 2, to: 2 },
    ];
    const out = layoutAllDayLane(dayKeys, lane(specs), { expanded: true });
    expect(out.rows).toBe(3);
    expect(out.bars).toHaveLength(4);
    expect(out.overflows).toBe(true);
    expect(out.hiddenByDay).toEqual([0, 0, 0, 0, 0, 0, 0]);
    // No two bars in one row cover the same day.
    for (const x of out.bars) {
      for (const y of out.bars) {
        if (x === y || x.row !== y.row) continue;
        const overlap = x.startCol < y.startCol + y.span && y.startCol < x.startCol + x.span;
        expect(overlap).toBe(false);
      }
    }
  });

  it("an empty week has no rows", () => {
    const out = layoutAllDayLane(dayKeys, new Map());
    expect(out.rows).toBe(0);
    expect(out.bars).toEqual([]);
    expect(out.overflows).toBe(false);
  });
});
