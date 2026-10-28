// CALR-16 contract (specs/calendar-rethink.md AC29, §Sharing "Preview as"):
// Preview renders your week exactly as the chosen teammate sees it. The
// masking is the server's: the preview reads calendar_events_visible and
// calendar_busy_blocks with p_as (supabase/tests/calendar_preview_as.test.sql
// proves those equal the teammate's own reads). The lens only labels what came
// back, so it can never drift from the real masking: it never changes a
// title, never drops or adds a row, and gives each block the reason the Event
// view explains.

process.env.TZ = "Europe/Warsaw";

import { describe, expect, it } from "@rstest/core";

import type { CalendarEventModel } from "./events";
import { previewBanner, previewExplain, previewLens } from "./share-lens";
import {
  busyBlockToEvent,
  type SharedCalendar,
  splitTeammateEvents,
  teammateBlocks,
} from "./teammates";

const iso = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString();

function ev(over: Partial<CalendarEventModel> & { id: string }): CalendarEventModel {
  return {
    workspaceId: "w",
    ownerId: "me",
    sourceAccountId: null,
    externalEventId: null,
    calendarId: "moduo",
    title: "Event",
    description: "",
    startsAt: iso(3, 10),
    endsAt: iso(3, 11),
    allDay: false,
    rrule: null,
    status: "confirmed",
    color: null,
    createdAt: iso(1, 0),
    updatedAt: iso(1, 0),
    deletedAt: null,
    calendarRef: "c-work",
    kind: "event",
    ...over,
  };
}

// What the server answers for Kai, about my week (the same rows whether Kai
// reads them or I preview as Kai).
const ROWS: CalendarEventModel[] = [
  ev({
    id: "board",
    title: "Board review",
    location: "Room 4",
    startsAt: iso(4, 10),
    endsAt: iso(4, 11),
  }),
  ev({ id: "therapy", title: "Busy", isPrivate: true, startsAt: iso(3, 17), endsAt: iso(3, 18) }),
  ev({ id: "focus", title: "Focus time", kind: "focus", startsAt: iso(5, 9), endsAt: iso(5, 11) }),
];
const BUSY = [
  busyBlockToEvent(
    {
      calendar_id: "c-family",
      owner_id: "me",
      start_time: iso(3, 8),
      end_time: iso(3, 8, 30),
      kind: "event",
      all_day: false,
    },
    "w",
    0,
  ),
];

describe("preview equals what they get", () => {
  const items = previewLens({ rows: ROWS, busy: BUSY });

  it("passes every row and block through untouched, in start order", () => {
    expect(items.map((i) => i.event.id)).toEqual([BUSY[0].id, "therapy", "board", "focus"]);
    for (const i of items) {
      const src = [...ROWS, ...BUSY].find((e) => e.id === i.event.id);
      expect(i.event).toEqual(src);
    }
  });

  it("gives each block its reason", () => {
    const reason = Object.fromEntries(items.map((i) => [i.event.id, i.reason]));
    expect(reason).toEqual({
      [BUSY[0].id]: "busy",
      therapy: "private",
      board: "details",
      focus: "focus",
    });
  });

  it("shows on the grid what the teammate's own lane of you would show", () => {
    // The same replies through Kai's side: my calendars are "shared with" Kai.
    const shared: SharedCalendar[] = [
      { calendarId: "c-work", ownerId: "me", level: "view" },
      { calendarId: "c-family", ownerId: "me", level: "freebusy" },
    ];
    const { theirs } = splitTeammateEvents([...ROWS, ...BUSY], shared);
    const lane = teammateBlocks(theirs, shared, {
      startMs: new Date(2026, 10, 2).getTime(),
      endMs: new Date(2026, 10, 9).getTime(),
    });
    const fromLane = lane.map((b) => [b.startMs, b.endMs, b.title ?? "Busy"]);
    const fromPreview = items.map((i) => [
      Date.parse(i.event.startsAt),
      Date.parse(i.event.endsAt),
      i.event.title,
    ]);
    expect(fromPreview).toEqual(fromLane);
  });

  it("an empty answer is an empty week (Nothing), never your own events", () => {
    expect(previewLens({ rows: [], busy: [] })).toEqual([]);
  });
});

describe("the preview explains itself", () => {
  it("says why each block looks as it does", () => {
    const items = previewLens({ rows: ROWS, busy: BUSY });
    const by = (id: string) => items.find((i) => i.event.id === id)!;
    expect(previewExplain(by("therapy"), "Kai", "Work")).toBe(
      "You marked this private, so Kai sees “Busy” whatever the level",
    );
    expect(previewExplain(by(BUSY[0].id), "Kai", "Family")).toBe(
      "Family is shared with Kai as Busy only, so Kai sees “Busy”",
    );
    expect(previewExplain(by("board"), "Kai", "Work")).toBe(
      "Work is shared with Kai at All details, so Kai sees it all",
    );
    expect(previewExplain(by("focus"), "Kai", "Work")).toBe("Kai sees “Focus time”");
  });

  it("the banner leads with Your calendar's level, then each calendar that differs", () => {
    expect(
      previewBanner("Kai Ito", [
        { name: "Your calendar", level: "view", main: true },
        { name: "Work", level: "view", main: false },
        { name: "Family", level: "freebusy", main: false },
        { name: "Holidays", level: "none", main: false },
      ]),
    ).toBe(
      "Your week as Kai Ito sees it · All details · Family shows as busy · Holidays isn't shared · private events show as busy · tasks stay with you",
    );
    expect(
      previewBanner("Nora Ruiz", [
        { name: "Your calendar", level: "freebusy", main: true },
        { name: "Work", level: "view", main: false },
      ]),
    ).toBe(
      "Your week as Nora Ruiz sees it · Busy only · Work shows all details · private events show as busy · tasks stay with you",
    );
    expect(previewBanner("Omar Diaz", [{ name: "Your calendar", level: "none", main: true }])).toBe(
      "Your week as Omar Diaz sees it · Nothing · private events show as busy · tasks stay with you",
    );
  });
});
