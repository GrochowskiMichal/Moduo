// AC12 on screen: the month grid is six week rows; a day's "N more" and its
// date open that day; the due count sits beside the date; past cells dim.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { EventChip } from "../events";
import { localDayKey, visibleRange } from "../lens";
import { CalendarMonth } from "./calendar-month";

afterEach(cleanup);

const range = visibleRange("month", new Date(2026, 9, 14), { weekStartsOn: 1, showWeekends: true });
const crowded = new Date(2026, 9, 22);

function chip(id: string, hour: number): EventChip {
  const startMs = new Date(2026, 9, 22, hour).getTime();
  return {
    eventId: id,
    occurrenceKey: `${id}:${startMs}`,
    title: `Meeting ${id}`,
    startMs,
    endMs: startMs + 30 * 60_000,
    dayKey: localDayKey(crowded),
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

function month(over: Partial<Parameters<typeof CalendarMonth>[0]> = {}) {
  const props: Parameters<typeof CalendarMonth>[0] = {
    days: range.days,
    now: new Date(2026, 9, 14, 12),
    eventsByDay: new Map([
      [localDayKey(crowded), [9, 10, 11, 12, 13, 14, 15].map((h) => chip(`e${h}`, h))],
    ]),
    allDayByDay: new Map(),
    blocksByDay: new Map(),
    dueByDay: new Map([
      ["2026-10-16", [{ taskId: "t1", title: "Send the deck", dayKey: "2026-10-16", done: false }]],
    ]),
    accountHues: {},
    selectedOccurrenceKey: null,
    onSelectOccurrence: () => {},
    onEventClick: () => {},
    onTaskClick: () => {},
    onOpenDay: () => {},
    onDueClick: () => {},
    ...over,
  };
  return render(<CalendarMonth {...props} />);
}

describe("month view", () => {
  it("draws six week rows of days", () => {
    const { container } = month();
    expect(container.querySelectorAll("[data-month-week]")).toHaveLength(6);
    expect(container.querySelectorAll("[data-month-cell]")).toHaveLength(42);
  });

  it("opens the day from its 'N more' and from its date", () => {
    const onOpenDay = rs.fn();
    month({ onOpenDay });
    fireEvent.click(screen.getByRole("button", { name: /more on Thu, Oct 22/ }));
    expect(onOpenDay).toHaveBeenCalledTimes(1);
    expect(localDayKey(onOpenDay.mock.calls[0][0] as Date)).toBe("2026-10-22");
    fireEvent.click(screen.getByRole("button", { name: "Open Fri, Oct 16" }));
    expect(localDayKey(onOpenDay.mock.calls[1][0] as Date)).toBe("2026-10-16");
  });

  it("puts the due count beside the date and dims the past", () => {
    const { container } = month();
    expect(screen.getByRole("button", { name: /1 due on Fri, Oct 16/ })).toBeTruthy();
    expect(
      container.querySelector('[data-month-cell="2026-10-13"]')?.hasAttribute("data-past"),
    ).toBe(true);
    expect(
      container.querySelector('[data-month-cell="2026-10-15"]')?.hasAttribute("data-past"),
    ).toBe(false);
    expect(
      container.querySelector('[data-month-cell="2026-10-14"]')?.hasAttribute("data-today"),
    ).toBe(true);
  });

  it("opens an event like a click on the week grid", () => {
    const onEventClick = rs.fn();
    const onSelectOccurrence = rs.fn();
    month({ onEventClick, onSelectOccurrence });
    fireEvent.click(screen.getByRole("button", { name: /Meeting e9/ }));
    expect(onSelectOccurrence).toHaveBeenCalledWith(chip("e9", 9).occurrenceKey);
    expect(onEventClick).toHaveBeenCalledTimes(1);
  });
});
