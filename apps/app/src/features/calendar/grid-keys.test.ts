// AC22 (CALR-4): the grid by keys alone. Arrows move a 30-minute cursor (a
// busy slot picks its event), J/K step through events in time order, ⌥
// arrows move an event 15 minutes or a day (wall time kept) and ⌥⇧ arrows
// change its length; ⌘C/⌘V/⌘D copy, paste and duplicate it.

process.env.TZ = "Europe/Warsaw";

import { describe, expect, it } from "@rstest/core";

import type { CalendarEventModel, EventChip } from "./events";
import {
  adjacentChip,
  chipAtCursor,
  copyDraft,
  cursorAfterPeriod,
  cursorBox,
  cursorForChip,
  duplicateStartMs,
  type GridCursor,
  keyedChange,
  slotSpan,
  stepCursor,
} from "./grid-keys";
import { localDayKey } from "./lens";

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
const key = (d: number) => localDayKey(new Date(2026, 10, d));
// Mon 2 Nov … Fri 6 Nov 2026
const WEEK = [2, 3, 4, 5, 6].map(key);

function chip(id: string, d: number, h: number, m: number, minutes: number): EventChip {
  const startMs = at(d, h, m);
  return {
    eventId: id,
    occurrenceKey: `${id}:${startMs}`,
    title: id,
    startMs,
    endMs: startMs + minutes * 60_000,
    dayKey: key(d),
    allDay: false,
    external: false,
    readOnly: false,
    recurring: false,
    sourceAccountId: null,
    color: null,
    continuesFromMs: null,
    continuesToMs: null,
    locked: false,
  };
}

const STANDUP = chip("standup", 3, 9, 0, 30);
const REVIEW = chip("review", 3, 14, 0, 60);
const LUNCH = chip("lunch", 4, 12, 0, 60);
const CHIPS = [LUNCH, REVIEW, STANDUP];

describe("stepCursor", () => {
  const c: GridCursor = { dayKey: key(3), minute: 600 };

  it("↑ and ↓ move 30 minutes, held inside the day", () => {
    expect(stepCursor(c, "down", WEEK)).toEqual({
      cursor: { dayKey: key(3), minute: 630 },
      period: 0,
    });
    expect(stepCursor(c, "up", WEEK).cursor.minute).toBe(570);
    expect(stepCursor({ dayKey: key(3), minute: 0 }, "up", WEEK).cursor.minute).toBe(0);
    expect(stepCursor({ dayKey: key(3), minute: 1410 }, "down", WEEK).cursor.minute).toBe(1410);
  });

  it("← and → move a day; past the edge they ask for the next period", () => {
    expect(stepCursor(c, "left", WEEK)).toEqual({
      cursor: { dayKey: key(2), minute: 600 },
      period: 0,
    });
    expect(stepCursor(c, "right", WEEK).cursor.dayKey).toBe(key(4));
    expect(stepCursor({ dayKey: key(2), minute: 600 }, "left", WEEK).period).toBe(-1);
    expect(stepCursor({ dayKey: key(6), minute: 600 }, "right", WEEK).period).toBe(1);
  });

  it("after a period step the cursor lands on the near edge, same time", () => {
    expect(cursorAfterPeriod(WEEK, -1, 600)).toEqual({ dayKey: key(6), minute: 600 });
    expect(cursorAfterPeriod(WEEK, 1, 600)).toEqual({ dayKey: key(2), minute: 600 });
  });
});

describe("the cursor and events", () => {
  it("a slot covers 30 minutes of its day", () => {
    expect(slotSpan({ dayKey: key(3), minute: 540 })).toEqual({
      startMs: at(3, 9),
      endMs: at(3, 9, 30),
    });
  });

  it("a busy slot picks the event under it; a free one picks nothing", () => {
    expect(chipAtCursor({ dayKey: key(3), minute: 540 }, CHIPS)?.eventId).toBe("standup");
    expect(chipAtCursor({ dayKey: key(3), minute: 870 }, CHIPS)?.eventId).toBe("review");
    expect(chipAtCursor({ dayKey: key(3), minute: 600 }, CHIPS)).toBeNull();
  });

  it("a chip puts the cursor on the slot it starts in", () => {
    expect(cursorForChip(chip("x", 4, 12, 45, 30))).toEqual({ dayKey: key(4), minute: 750 });
  });

  it("J and K step through events in time order, across days", () => {
    expect(adjacentChip(CHIPS, { selectedKey: STANDUP.occurrenceKey, cursor: null }, 1)).toBe(
      REVIEW,
    );
    expect(adjacentChip(CHIPS, { selectedKey: REVIEW.occurrenceKey, cursor: null }, 1)).toBe(LUNCH);
    expect(adjacentChip(CHIPS, { selectedKey: REVIEW.occurrenceKey, cursor: null }, -1)).toBe(
      STANDUP,
    );
    expect(adjacentChip(CHIPS, { selectedKey: LUNCH.occurrenceKey, cursor: null }, 1)).toBeNull();
  });

  it("with nothing selected, J and K start from the cursor (else the first or last)", () => {
    const noon3 = { dayKey: key(3), minute: 720 };
    expect(adjacentChip(CHIPS, { selectedKey: null, cursor: noon3 }, 1)).toBe(REVIEW);
    expect(adjacentChip(CHIPS, { selectedKey: null, cursor: noon3 }, -1)).toBe(STANDUP);
    expect(adjacentChip(CHIPS, { selectedKey: null, cursor: null }, 1)).toBe(STANDUP);
    expect(adjacentChip(CHIPS, { selectedKey: null, cursor: null }, -1)).toBe(LUNCH);
  });
});

describe("cursorBox (what the cursor outlines)", () => {
  const meeting = chip("meeting", 3, 10, 0, 60);
  const lunch = chip("lunch", 3, 13, 0, 30);
  const c = (minute: number): GridCursor => ({ dayKey: key(3), minute });

  it("a free slot outlines its 30 minutes", () => {
    expect(cursorBox(c(14 * 60), [meeting, lunch], null)).toEqual({ minute: 14 * 60, minutes: 30 });
  });

  it("a busy slot outlines the event under it, never nothing", () => {
    expect(cursorBox(c(10 * 60 + 30), [meeting, lunch], null)).toEqual({
      minute: 10 * 60,
      minutes: 60,
    });
    // Another event's selection doesn't hide it.
    expect(cursorBox(c(10 * 60 + 30), [meeting, lunch], lunch.occurrenceKey)).toEqual({
      minute: 10 * 60,
      minutes: 60,
    });
  });

  it("on the selected event it draws nothing: the selection ring shows", () => {
    expect(cursorBox(c(10 * 60), [meeting, lunch], meeting.occurrenceKey)).toBeNull();
  });

  it("a short event still gets a 15-minute box", () => {
    const quick = chip("quick", 3, 9, 0, 5);
    expect(cursorBox(c(9 * 60), [quick], null)).toEqual({ minute: 9 * 60, minutes: 15 });
  });
});

describe("keyedChange (⌥ arrows)", () => {
  const span = { startMs: at(3, 14), endMs: at(3, 15), allDay: false };
  const m15 = 15 * 60_000;

  it("⌥↑ / ⌥↓ move 15 minutes", () => {
    expect(keyedChange(span, "earlier")).toEqual({ startDeltaMs: -m15, endDeltaMs: -m15 });
    expect(keyedChange(span, "later")).toEqual({ startDeltaMs: m15, endDeltaMs: m15 });
  });

  it("⌥← / ⌥→ move a day at the same wall time, a clock change included", () => {
    const next = keyedChange(span, "next-day");
    expect(span.startMs + (next?.startDeltaMs ?? 0)).toBe(at(4, 14));
    expect(span.endMs + (next?.endDeltaMs ?? 0)).toBe(at(4, 15));
    // 25 Oct 2026 is the night the clocks go back in Europe: still 14:00 next day.
    const before = { startMs: new Date(2026, 9, 24, 14).getTime(), endMs: 0, allDay: false };
    before.endMs = before.startMs + 3_600_000;
    const moved = keyedChange(before, "next-day");
    expect(new Date(before.startMs + (moved?.startDeltaMs ?? 0)).getHours()).toBe(14);
    const prev = keyedChange(span, "prev-day");
    expect(span.startMs + (prev?.startDeltaMs ?? 0)).toBe(at(2, 14));
  });

  it("⌥⇧↑ / ⌥⇧↓ change the length by 15 minutes, never below 15", () => {
    expect(keyedChange(span, "shorter")).toEqual({ startDeltaMs: 0, endDeltaMs: -m15 });
    expect(keyedChange(span, "longer")).toEqual({ startDeltaMs: 0, endDeltaMs: m15 });
    expect(keyedChange({ ...span, endMs: span.startMs + m15 }, "shorter")).toBeNull();
  });

  it("an all-day event moves by days only", () => {
    const allDay = { startMs: at(3, 0), endMs: at(4, 0), allDay: true };
    expect(keyedChange(allDay, "later")).toBeNull();
    expect(keyedChange(allDay, "longer")).toBeNull();
    expect(keyedChange(allDay, "next-day")).not.toBeNull();
  });
});

describe("copy, paste and duplicate", () => {
  const source = {
    id: "ev",
    title: "Design review",
    description: "Agenda",
    startsAt: new Date(at(3, 14)).toISOString(),
    endsAt: new Date(at(3, 15)).toISOString(),
    allDay: false,
    rrule: "FREQ=WEEKLY",
    sourceAccountId: null,
  } as CalendarEventModel;

  it("a copy keeps the title, notes and length, lands where asked, and doesn't repeat", () => {
    expect(copyDraft(source, at(5, 10))).toEqual({
      title: "Design review",
      description: "Agenda",
      startsAt: new Date(at(5, 10)).toISOString(),
      endsAt: new Date(at(5, 11)).toISOString(),
      allDay: false,
      rrule: null,
      calendarId: "moduo",
    });
  });

  it("a copy of a Google event goes back to the same account", () => {
    expect(copyDraft({ ...source, sourceAccountId: "acc-g" }, at(5, 10)).calendarId).toBe("acc-g");
  });

  it("a duplicate lands right after the occurrence it copies", () => {
    expect(duplicateStartMs({ startMs: at(3, 14), endMs: at(3, 15) })).toBe(at(3, 15));
  });
});
