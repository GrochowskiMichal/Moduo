// AC22 (CALR-4): the grid is one Tab stop with a cursor. Focusing it puts the
// cursor at now; when now falls inside an event (10:30, a 10:00–11:00
// meeting) the busy slot outlines that event, so the cursor never vanishes.
// It used to hide on any busy slot, so the e2e journey failed between 10:00
// and 11:00, the hour its own seeded event fills.

process.env.TZ = "Europe/Warsaw";

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, render } from "@testing-library/react";

import { HotkeyScope } from "../../../lib/hotkeys";
import type { EventChip } from "../events";
import { localDayKey } from "../lens";
import { DEFAULT_CALENDAR_PREFS } from "../prefs";
import { GridCursorMark } from "./grid-cursor";
import { gridY } from "./grid-units";
import { useCalendarHotkeys } from "./use-calendar-hotkeys";

const DAY = new Date(2026, 10, 3); // Tue 3 Nov 2026
const at = (h: number, m = 0) => new Date(2026, 10, 3, h, m).getTime();

function chip(id: string, h: number, minutes: number): EventChip {
  const startMs = at(h);
  return {
    eventId: id,
    occurrenceKey: `${id}:${startMs}`,
    title: id,
    startMs,
    endMs: startMs + minutes * 60_000,
    dayKey: localDayKey(DAY),
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

function Harness({ chips, selected }: { chips: EventChip[]; selected: string | null }) {
  const days = [DAY];
  const keys = useCalendarHotkeys({
    view: "day",
    days,
    chips: { timed: new Map([[localDayKey(DAY), chips]]), allDay: new Map() },
    eventsById: new Map(),
    canEdit: true,
    isWritable: () => true,
    prefs: DEFAULT_CALENDAR_PREFS,
    workspaceId: "ws-1",
    panelVariant: "tasks",
    selectedOccurrenceKey: selected,
    select: () => {},
    setView: () => {},
    goToday: () => {},
    step: () => {},
    occurrence: { requestEventDelete: () => {}, occurrenceStartOf: () => 0 },
    onMoveEvent: () => {},
    createEvent: () => {},
    onEventClick: () => {},
    openDetail: () => {},
  });
  return (
    <div data-calendar-grid="" tabIndex={0}>
      {keys.cursor ? <GridCursorMark cursor={keys.cursor} days={days} /> : null}
    </div>
  );
}

function focusGridAt(h: number, m: number, chips: EventChip[], selected: string | null = null) {
  rs.setSystemTime(new Date(2026, 10, 3, h, m));
  const view = render(
    <HotkeyScope scope="calendar">
      <Harness chips={chips} selected={selected} />
    </HotkeyScope>,
  );
  act(() => view.container.querySelector<HTMLElement>("[data-calendar-grid]")!.focus());
  return view.container.querySelector<HTMLElement>("[data-grid-cursor]");
}

beforeEach(() => {
  rs.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  cleanup();
  rs.useRealTimers();
});

describe("the grid cursor on focus", () => {
  it("on a free slot it outlines the 30 minutes at now", () => {
    const mark = focusGridAt(14, 40, [chip("standup", 10, 60)]);
    expect(mark).not.toBeNull();
    expect(mark!.style.top).toBe(gridY(14 * 60 + 30));
    expect(mark!.style.height).toBe(gridY(30));
  });

  it("at 10:30 inside a 10:00–11:00 event it outlines that event, not nothing", () => {
    const mark = focusGridAt(10, 30, [chip("standup", 10, 60)]);
    expect(mark).not.toBeNull();
    // The event's box, not the 10:30 slot's.
    expect(mark!.style.top).toBe(gridY(10 * 60));
    expect(mark!.style.height).toBe(gridY(60));
  });

  it("draws nothing over the selected event: its own selection ring shows", () => {
    const standup = chip("standup", 10, 60);
    expect(focusGridAt(10, 30, [standup], standup.occurrenceKey)).toBeNull();
  });
});
