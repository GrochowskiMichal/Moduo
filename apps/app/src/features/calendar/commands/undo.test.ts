// AC21 (CALR-4): every edit undoes. Add, delete, move, resize and place each
// push one undo step (with an Undo toast) that ⌘Z (`undoLast`) or the toast's
// Undo runs once, putting the event back exactly. A Moduo event deletes at
// once (its Undo is the safety net); only a Google event, whose delete has no
// Undo and emails its guests, still confirms.

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, renderHook, waitFor } from "@testing-library/react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { supabaseClient } from "../../../lib/runtime.web.client";
import type { CalendarEventModel } from "../events";
import { useCalendarModule } from "../hooks/use-calendar-module";
import {
  clearUndo,
  deleteNeedsConfirm,
  inversePatch,
  placeTask,
  recordUndo,
  undoDepth,
  undoLast,
} from "./undo";

const h = rs.hoisted(() => ({
  toasts: [] as Array<{ label: string; onUndo: () => void }>,
}));

rs.mock("../../../lib/undo-toast", () => ({
  UNDO_TOAST_MS: 8000,
  undoToast: (label: string, opts: { onUndo: () => void }) => {
    h.toasts.push({ label, onUndo: opts.onUndo });
    return h.toasts.length;
  },
}));

rs.mock("sonner", () => {
  const toast = Object.assign(() => 0, {
    error: () => 0,
    success: () => 0,
    dismiss: () => {},
  });
  return { toast };
});

function event(over: Partial<CalendarEventModel> = {}): CalendarEventModel {
  return {
    id: "ev1",
    workspaceId: "w1",
    ownerId: "u1",
    sourceAccountId: null,
    externalEventId: null,
    calendarId: "moduo",
    title: "Design review",
    description: "Agenda",
    startsAt: "2026-11-02T09:00:00.000Z",
    endsAt: "2026-11-02T10:00:00.000Z",
    allDay: false,
    rrule: null,
    status: "confirmed",
    color: null,
    createdAt: "2026-10-28T08:00:00Z",
    updatedAt: "2026-10-28T08:00:00Z",
    deletedAt: null,
    isPrivate: false,
    location: null,
    ...over,
  };
}

const ORIGINAL = event();
const SERIES = event({ id: "series", title: "Standup", rrule: "FREQ=DAILY" });

function fakeRuntime(rows: CalendarEventModel[]) {
  const calendar = {
    listModule: rs.fn(async () => ({
      events: rows,
      accounts: [],
      degraded: false,
      truncated: [],
    })),
    createEvent: rs.fn(async (input: { title: string; startsAt: string; endsAt: string }) =>
      event({ id: "new1", ...input }),
    ),
    updateEvent: rs.fn(
      async ({ eventId, patch }: { eventId: string; patch: Partial<CalendarEventModel> }) => {
        const base = rows.find((r) => r.id === eventId) ?? ORIGINAL;
        return { ...base, ...patch };
      },
    ),
    removeEvent: rs.fn(async () => {}),
    restoreEvent: rs.fn(async ({ eventId }: { eventId: string }) =>
      rows.find((r) => r.id === eventId),
    ),
    updateOccurrence: rs.fn(
      async (input: { originalStart: string; patch: Partial<CalendarEventModel> }) =>
        event({
          id: "ov1",
          title: "Standup",
          seriesId: "series",
          originalStart: input.originalStart,
          ...input.patch,
        }),
    ),
    removeOccurrence: rs.fn(async () => {}),
    restoreOccurrence: rs.fn(async () => SERIES),
  };
  return { runtime: { calendar } as unknown as ModuoRuntime, calendar };
}

async function mounted(rows: CalendarEventModel[]) {
  const fake = fakeRuntime(rows);
  const hook = renderHook(() =>
    useCalendarModule(fake.runtime, { userId: "u1", workspaceId: "w1", modulePermission: "edit" }),
  );
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  const byId = (id: string) => hook.result.current.events.find((e) => e.id === id);
  return { ...fake, hook, byId };
}

beforeEach(() => {
  h.toasts.length = 0;
  clearUndo();
  rs.spyOn(supabaseClient, "rpc").mockImplementation((() =>
    Promise.resolve({ data: [], error: null })) as never);
});

afterEach(() => {
  rs.restoreAllMocks();
});

describe("the undo stack", () => {
  it("undoes the last step first, each step once", async () => {
    const ran: string[] = [];
    recordUndo("first", () => void ran.push("first"));
    recordUndo("second", () => void ran.push("second"));
    expect(undoDepth()).toBe(2);
    expect(undoLast()).toBe(true);
    expect(undoLast()).toBe(true);
    expect(undoLast()).toBe(false);
    expect(ran).toEqual(["second", "first"]);
  });

  it("shows an Undo toast when asked, and the toast and ⌘Z never both run a step", () => {
    const run = rs.fn();
    recordUndo("Event moved", run, { toast: true });
    expect(h.toasts.map((t) => t.label)).toEqual(["Event moved"]);
    expect(undoLast()).toBe(true);
    h.toasts[0].onUndo();
    expect(run).toHaveBeenCalledTimes(1);
    expect(undoDepth()).toBe(0);
  });

  it("the toast's Undo takes its own step off the stack", () => {
    const run = rs.fn();
    recordUndo("Event added", run, { toast: true });
    h.toasts[0].onUndo();
    expect(run).toHaveBeenCalledTimes(1);
    expect(undoLast()).toBe(false);
  });

  it("clears (a workspace switch, leaving Calendar)", () => {
    recordUndo("x", () => {});
    clearUndo();
    expect(undoDepth()).toBe(0);
  });
});

describe("inversePatch", () => {
  it("puts back exactly the fields an edit touched", () => {
    expect(
      inversePatch(ORIGINAL, {
        startsAt: "2026-11-02T09:15:00.000Z",
        endsAt: "2026-11-02T10:15:00.000Z",
      }),
    ).toEqual({ startsAt: ORIGINAL.startsAt, endsAt: ORIGINAL.endsAt });
    expect(inversePatch(ORIGINAL, { endsAt: "2026-11-02T10:30:00.000Z" })).toEqual({
      endsAt: ORIGINAL.endsAt,
    });
    expect(inversePatch(ORIGINAL, { title: "Renamed", isPrivate: true })).toEqual({
      title: "Design review",
      isPrivate: false,
    });
    expect(inversePatch(ORIGINAL, { location: "Studio" })).toEqual({ location: null });
  });

  it("a Meet link added is removed, one removed is added back", () => {
    expect(inversePatch(ORIGINAL, { meet: "add" })).toEqual({ meet: "remove" });
    expect(inversePatch(ORIGINAL, { meet: "remove" })).toEqual({ meet: "add" });
  });
});

describe("deleteNeedsConfirm", () => {
  it("a Moduo event deletes at once; a Google one (no Undo) confirms", () => {
    expect(deleteNeedsConfirm(ORIGINAL)).toBe(false);
    expect(deleteNeedsConfirm(event({ sourceAccountId: "acc-g", externalEventId: "g1" }))).toBe(
      true,
    );
  });
});

describe("every edit undoes (the module's writes)", () => {
  it("add: one step with an Undo toast; undo removes the new event", async () => {
    const m = await mounted([]);
    await act(async () => {
      await m.hook.result.current.createEvent({
        title: "Lunch",
        startsAt: "2026-11-02T12:00:00.000Z",
        endsAt: "2026-11-02T13:00:00.000Z",
      });
    });
    expect(undoDepth()).toBe(1);
    expect(h.toasts).toHaveLength(1);
    await act(async () => {
      undoLast();
    });
    await waitFor(() =>
      expect(m.calendar.removeEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: "new1" }),
      ),
    );
    await waitFor(() => expect(m.byId("new1")).toBeUndefined());
    expect(undoDepth()).toBe(0);
  });

  it("delete: one step with an Undo toast; undo restores the event as it was", async () => {
    const m = await mounted([ORIGINAL]);
    await act(async () => {
      await m.hook.result.current.deleteEvent("ev1");
    });
    expect(m.byId("ev1")).toBeUndefined();
    expect(undoDepth()).toBe(1);
    expect(h.toasts).toHaveLength(1);
    await act(async () => {
      undoLast();
    });
    await waitFor(() => expect(m.byId("ev1")).toEqual(ORIGINAL));
    expect(m.calendar.restoreEvent).toHaveBeenCalledTimes(1);
  });

  it("move: one step with an Undo toast; undo writes the old times back", async () => {
    const m = await mounted([ORIGINAL]);
    await act(async () => {
      await m.hook.result.current.updateEvent("ev1", {
        startsAt: "2026-11-02T09:15:00.000Z",
        endsAt: "2026-11-02T10:15:00.000Z",
      });
    });
    expect(undoDepth()).toBe(1);
    expect(h.toasts.map((t) => t.label)).toEqual(["Event moved"]);
    await act(async () => {
      undoLast();
    });
    await waitFor(() =>
      expect(m.calendar.updateEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({
          eventId: "ev1",
          patch: { startsAt: ORIGINAL.startsAt, endsAt: ORIGINAL.endsAt },
        }),
      ),
    );
    await waitFor(() => expect(m.byId("ev1")?.startsAt).toBe(ORIGINAL.startsAt));
    expect(m.byId("ev1")?.endsAt).toBe(ORIGINAL.endsAt);
    // The undo itself is not a new step.
    expect(undoDepth()).toBe(0);
  });

  it("resize: one step with an Undo toast; undo puts the old end back", async () => {
    const m = await mounted([ORIGINAL]);
    await act(async () => {
      await m.hook.result.current.updateEvent("ev1", { endsAt: "2026-11-02T10:30:00.000Z" });
    });
    expect(h.toasts.map((t) => t.label)).toEqual(["Event resized"]);
    await act(async () => {
      undoLast();
    });
    await waitFor(() =>
      expect(m.calendar.updateEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({ patch: { endsAt: ORIGINAL.endsAt } }),
      ),
    );
    await waitFor(() => expect(m.byId("ev1")?.endsAt).toBe(ORIGINAL.endsAt));
  });

  it("any other edit (a rename) is one ⌘Z step, without a toast", async () => {
    const m = await mounted([ORIGINAL]);
    await act(async () => {
      await m.hook.result.current.updateEvent("ev1", { title: "Renamed" });
    });
    expect(undoDepth()).toBe(1);
    expect(h.toasts).toHaveLength(0);
    await act(async () => {
      undoLast();
    });
    await waitFor(() => expect(m.byId("ev1")?.title).toBe("Design review"));
  });

  it("moving one occurrence of a repeat (This event) undoes back to its own slot", async () => {
    const m = await mounted([SERIES]);
    const at = Date.parse("2026-11-04T09:00:00.000Z");
    await act(async () => {
      await m.hook.result.current.writeOccurrence("series", at, "this", {
        kind: "patch",
        patch: { startsAt: "2026-11-04T11:00:00.000Z", endsAt: "2026-11-04T12:00:00.000Z" },
      });
    });
    expect(undoDepth()).toBe(1);
    expect(h.toasts.map((t) => t.label)).toEqual(["Event moved"]);
    await act(async () => {
      undoLast();
    });
    await waitFor(() =>
      expect(m.calendar.updateOccurrence).toHaveBeenLastCalledWith(
        expect.objectContaining({
          seriesId: "series",
          originalStart: "2026-11-04T09:00:00.000Z",
          patch: { startsAt: "2026-11-04T09:00:00.000Z", endsAt: "2026-11-04T10:00:00.000Z" },
        }),
      ),
    );
  });

  it("deleting one occurrence undoes through the occurrence restore", async () => {
    const m = await mounted([SERIES]);
    const at = Date.parse("2026-11-04T09:00:00.000Z");
    await act(async () => {
      await m.hook.result.current.writeOccurrence("series", at, "this", { kind: "delete" });
    });
    expect(undoDepth()).toBe(1);
    await act(async () => {
      undoLast();
    });
    await waitFor(() => expect(m.calendar.restoreOccurrence).toHaveBeenCalledTimes(1));
  });
});

describe("place: a task put on the grid", () => {
  it("one step with an Undo toast; undo puts its old schedule back", () => {
    const patchTask = rs.fn();
    placeTask(
      { patchTask },
      { id: "t1", scheduledAt: null, durationMinutes: 45 },
      { scheduledAt: "2026-11-02T14:00:00.000Z", durationMinutes: 45 },
    );
    expect(patchTask).toHaveBeenLastCalledWith("t1", {
      scheduledAt: "2026-11-02T14:00:00.000Z",
      durationMinutes: 45,
    });
    expect(undoDepth()).toBe(1);
    expect(h.toasts).toHaveLength(1);
    undoLast();
    expect(patchTask).toHaveBeenLastCalledWith("t1", { scheduledAt: null, durationMinutes: 45 });
  });

  it("a block moved on the grid undoes to where it was", () => {
    const patchTask = rs.fn();
    placeTask(
      { patchTask },
      { id: "t1", scheduledAt: "2026-11-02T09:00:00.000Z", durationMinutes: 30 },
      { scheduledAt: "2026-11-02T10:00:00.000Z", durationMinutes: 60 },
    );
    undoLast();
    expect(patchTask).toHaveBeenLastCalledWith("t1", {
      scheduledAt: "2026-11-02T09:00:00.000Z",
      durationMinutes: 30,
    });
  });
});
