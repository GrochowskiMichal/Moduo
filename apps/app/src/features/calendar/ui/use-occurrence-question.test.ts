// AC44 (CALR-11): the week asks "This event / All events" before changing one
// occurrence of a repeat, and only then; the answer writes that occurrence.

import { describe, expect, it, rs } from "@rstest/core";
import { act, renderHook } from "@testing-library/react";

import type { CalendarEventModel } from "../events";
import { useOccurrenceQuestion } from "./use-occurrence-question";

function event(over: Partial<CalendarEventModel>): CalendarEventModel {
  return {
    id: "ev",
    workspaceId: "w1",
    ownerId: "u1",
    sourceAccountId: null,
    externalEventId: null,
    calendarId: "moduo",
    title: "Standup",
    description: "",
    startsAt: "2026-11-02T08:00:00.000Z",
    endsAt: "2026-11-02T08:30:00.000Z",
    allDay: false,
    rrule: null,
    status: "confirmed",
    color: null,
    createdAt: "2026-10-28T08:00:00Z",
    updatedAt: "2026-10-28T08:00:00Z",
    deletedAt: null,
    ...over,
  };
}

const SERIES = event({ id: "series", rrule: "FREQ=DAILY" });
const LUNCH = event({ id: "lunch", title: "Lunch" });
const THURSDAY = Date.parse("2026-11-05T08:00:00.000Z");
const BY_ID = new Map([SERIES, LUNCH].map((e) => [e.id, e]));

function setup(selected: string | null = null) {
  const updateEvent = rs.fn(async () => {});
  const writeOccurrence = rs.fn(async () => {});
  const confirmDelete = rs.fn();
  const hook = renderHook(() =>
    useOccurrenceQuestion({
      eventsById: BY_ID,
      selectedOccurrenceKey: selected,
      updateEvent,
      writeOccurrence,
      confirmDelete,
    }),
  );
  return { hook, updateEvent, writeOccurrence, confirmDelete };
}

describe("useOccurrenceQuestion", () => {
  it("an event that doesn't repeat never asks: edits save, deletes confirm as before", () => {
    const { hook, updateEvent, confirmDelete } = setup();
    act(() => {
      hook.result.current.patchEvent("lunch", { title: "Long lunch" });
      hook.result.current.requestEventDelete("lunch");
    });
    expect(updateEvent).toHaveBeenCalledWith("lunch", { title: "Long lunch" });
    expect(confirmDelete).toHaveBeenCalledWith("lunch");
    expect(hook.result.current.dialog.question).toBeNull();
  });

  it("dragging one occurrence asks, and This event writes that occurrence's new span", () => {
    const { hook, writeOccurrence } = setup();
    let asked = false;
    act(() => {
      asked = hook.result.current.askMove(
        "series",
        { startDeltaMs: 3_600_000, endDeltaMs: 3_600_000 },
        { startMs: THURSDAY, endMs: THURSDAY + 1_800_000 },
      );
    });
    expect(asked).toBe(true);
    expect(hook.result.current.dialog.question).toEqual({
      action: "change",
      title: "Standup",
      allEvents: true,
      note: null,
    });
    act(() => hook.result.current.dialog.onAnswer("this"));
    expect(writeOccurrence).toHaveBeenCalledWith("series", THURSDAY, "this", {
      kind: "patch",
      patch: { startsAt: "2026-11-05T09:00:00.000Z", endsAt: "2026-11-05T09:30:00.000Z" },
    });
    expect(hook.result.current.dialog.question).toBeNull();
  });

  it("a delete of the selected occurrence asks, and Cancel writes nothing", () => {
    const { hook, writeOccurrence, confirmDelete } = setup(`series:${THURSDAY}`);
    act(() => hook.result.current.requestEventDelete("series"));
    expect(hook.result.current.dialog.question?.action).toBe("delete");
    act(() => hook.result.current.dialog.onCancel());
    expect(hook.result.current.dialog.question).toBeNull();
    expect(writeOccurrence).not.toHaveBeenCalled();
    expect(confirmDelete).not.toHaveBeenCalled();
  });

  it("a panel time edit on a series moves to the selected occurrence's day", () => {
    const { hook, writeOccurrence } = setup(`series:${THURSDAY}`);
    act(() =>
      hook.result.current.patchEvent("series", {
        startsAt: "2026-11-02T09:00:00.000Z",
        endsAt: "2026-11-02T09:30:00.000Z",
      }),
    );
    act(() => hook.result.current.dialog.onAnswer("all"));
    expect(writeOccurrence).toHaveBeenCalledWith("series", THURSDAY, "all", {
      kind: "patch",
      patch: { startsAt: "2026-11-05T09:00:00.000Z", endsAt: "2026-11-05T09:30:00.000Z" },
    });
  });

  it("changing the repeat itself never asks", () => {
    const { hook, updateEvent } = setup(`series:${THURSDAY}`);
    act(() => hook.result.current.patchEvent("series", { rrule: "FREQ=WEEKLY" }));
    expect(updateEvent).toHaveBeenCalledWith("series", { rrule: "FREQ=WEEKLY" });
    expect(hook.result.current.dialog.question).toBeNull();
  });
});
