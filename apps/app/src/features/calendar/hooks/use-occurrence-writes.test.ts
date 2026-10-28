// AC44 (CALR-11): the write behind This event / All events, on the open week.
// Optimistic like the module's other writes: the week shows the change at once,
// a refusal puts it back, and a delete's Undo restores the occurrence.

import { beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { CalendarAccountModel, CalendarEventModel } from "../events";
import { useOccurrenceWrites } from "./use-occurrence-writes";

const h = rs.hoisted(() => ({
  errors: [] as string[],
  undo: null as null | (() => void),
}));

rs.mock("sonner", () => {
  const toast = Object.assign(() => {}, {
    error: (message: string) => h.errors.push(message),
    success: () => {},
  });
  return { toast };
});

rs.mock("../../../lib/undo-toast", () => ({
  undoToast: (_title: string, opts: { onUndo: () => void }) => {
    h.undo = opts.onUndo;
  },
}));

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
    exdates: [],
    ...over,
  };
}

const SERIES = event({ id: "series", rrule: "FREQ=DAILY" });
const OVERRIDE = event({
  id: "ov",
  title: "Standup (late)",
  seriesId: "series",
  originalStart: "2026-11-04T08:00:00.000Z",
  startsAt: "2026-11-04T09:00:00.000Z",
  endsAt: "2026-11-04T09:30:00.000Z",
});
const ACCOUNT = { id: "acc-g", provider: "google" } as CalendarAccountModel;
const instance = (day: string) =>
  event({
    id: `g-${day}`,
    sourceAccountId: "acc-g",
    externalEventId: `g-weekly_${day}`,
    externalSeriesId: "g-weekly",
    title: "Design review",
  });
const THURSDAY = Date.parse("2026-11-05T08:00:00.000Z");

function fakeRuntime(over: Partial<ModuoRuntime["calendar"]> = {}) {
  const calendar = {
    updateOccurrence: rs.fn(async () =>
      event({
        id: "ov-new",
        seriesId: "series",
        originalStart: "2026-11-05T08:00:00.000Z",
        startsAt: "2026-11-05T09:00:00.000Z",
        endsAt: "2026-11-05T09:30:00.000Z",
      }),
    ),
    removeOccurrence: rs.fn(async () => {}),
    restoreOccurrence: rs.fn(async () => SERIES),
    updateGoogleSeries: rs.fn(async () => {}),
    removeGoogleSeries: rs.fn(async () => {}),
    ...over,
  };
  return { calendar } as unknown as ModuoRuntime;
}

function setup(rows: CalendarEventModel[], runtime: ModuoRuntime) {
  const updateEvent = rs.fn(async () => {});
  const deleteEvent = rs.fn(async () => {});
  const reload = rs.fn(async () => {});
  const hook = renderHook(() => {
    const [events, setEvents] = useState(rows);
    const write = useOccurrenceWrites({
      runtime,
      workspaceId: "w1",
      scope: "w1",
      events,
      accounts: [ACCOUNT],
      setEventsIn: (_scope, next) => setEvents(next),
      canWrite: (e): e is CalendarEventModel => e !== undefined,
      updateEvent,
      deleteEvent,
      reload,
    });
    return { events, write };
  });
  const byId = (id: string) => hook.result.current.events.find((e) => e.id === id);
  return { hook, byId, updateEvent, deleteEvent, reload };
}

beforeEach(() => {
  h.errors.length = 0;
  h.undo = null;
});

describe("This event on a plain occurrence", () => {
  const move = {
    kind: "patch" as const,
    patch: { startsAt: "2026-11-05T09:00:00.000Z", endsAt: "2026-11-05T09:30:00.000Z" },
  };

  it("adds the exdate and the override, then keeps the saved override", async () => {
    const runtime = fakeRuntime();
    const { hook, byId } = setup([SERIES], runtime);
    await act(async () => {
      await hook.result.current.write("series", THURSDAY, "this", move);
    });
    expect(byId("series")?.exdates).toEqual(["2026-11-05T08:00:00.000Z"]);
    expect(byId("ov-new")?.startsAt).toBe("2026-11-05T09:00:00.000Z");
    expect(hook.result.current.events.some((e) => e.id.startsWith("tmp-"))).toBe(false);
  });

  it("a refusal puts the week back and says why", async () => {
    const runtime = fakeRuntime({
      updateOccurrence: rs.fn(async () => {
        throw new Error("Event not found in this workspace.");
      }),
    });
    const { hook, byId } = setup([SERIES], runtime);
    await act(async () => {
      await hook.result.current.write("series", THURSDAY, "this", move);
    });
    expect(byId("series")?.exdates).toEqual([]);
    expect(hook.result.current.events).toHaveLength(1);
    expect(h.errors).toEqual(["Event not found in this workspace."]);
  });
});

describe("This event, deleted", () => {
  it("drops the override at once, and Undo restores the occurrence", async () => {
    const runtime = fakeRuntime();
    const { hook, byId, reload } = setup(
      [{ ...SERIES, exdates: ["2026-11-04T08:00:00.000Z"] }, OVERRIDE],
      runtime,
    );
    await act(async () => {
      await hook.result.current.write("ov", Date.parse(OVERRIDE.startsAt), "this", {
        kind: "delete",
      });
    });
    expect(byId("ov")).toBeUndefined();
    expect(runtime.calendar.removeOccurrence).toHaveBeenCalledWith({
      workspaceId: "w1",
      seriesId: "series",
      originalStart: "2026-11-04T08:00:00.000Z",
    });
    await act(async () => {
      h.undo?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(runtime.calendar.restoreOccurrence).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalled();
  });

  it("a refusal brings the override back", async () => {
    const runtime = fakeRuntime({
      removeOccurrence: rs.fn(async () => {
        throw new Error("nope");
      }),
    });
    const { hook, byId } = setup([SERIES, OVERRIDE], runtime);
    await act(async () => {
      await hook.result.current.write("ov", Date.parse(OVERRIDE.startsAt), "this", {
        kind: "delete",
      });
    });
    expect(byId("ov")).toEqual(OVERRIDE);
    expect(byId("series")?.exdates).toEqual([]);
  });
});

describe("All events", () => {
  it("dragged from a changed occurrence moves that one and the series", async () => {
    const { hook, updateEvent } = setup([SERIES, OVERRIDE], fakeRuntime());
    const patch = { startsAt: "2026-11-04T09:15:00.000Z", endsAt: "2026-11-04T09:45:00.000Z" };
    await act(async () => {
      await hook.result.current.write("ov", Date.parse(OVERRIDE.startsAt), "all", {
        kind: "patch",
        patch,
      });
    });
    expect(updateEvent).toHaveBeenCalledWith("ov", { ...patch, allDay: undefined });
    expect(updateEvent).toHaveBeenCalledWith("series", {
      startsAt: "2026-11-02T08:15:00.000Z",
      endsAt: "2026-11-02T08:45:00.000Z",
    });
  });

  it("a Google repeat shows the new title on every instance, and back on refusal", async () => {
    const runtime = fakeRuntime({
      updateGoogleSeries: rs.fn(async () => {
        throw new Error("Forbidden");
      }),
    });
    const { hook, byId } = setup([instance("a"), instance("b")], runtime);
    await act(async () => {
      await hook.result.current.write("g-a", Date.parse(instance("a").startsAt), "all", {
        kind: "patch",
        patch: { title: "Design crit" },
      });
    });
    expect(runtime.calendar.updateGoogleSeries).toHaveBeenCalledTimes(1);
    expect(byId("g-a")?.title).toBe("Design review");
    expect(byId("g-b")?.title).toBe("Design review");
    expect(h.errors).toEqual(["Google didn't save it: Forbidden"]);
  });

  it("a Google repeat's instances go at once when the series is deleted", async () => {
    const runtime = fakeRuntime();
    const { hook } = setup([instance("a"), instance("b")], runtime);
    await act(async () => {
      await hook.result.current.write("g-a", Date.parse(instance("a").startsAt), "all", {
        kind: "delete",
      });
    });
    expect(hook.result.current.events).toEqual([]);
    expect(runtime.calendar.removeGoogleSeries).toHaveBeenCalledTimes(1);
  });
});
