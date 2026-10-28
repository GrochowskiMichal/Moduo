// "Move to another calendar" (CALR-4b) for a Moduo event going to a Google
// calendar you can write: one event, never two (the spec's "New events go to"
// assumption). Google gets it first; only then does the Moduo row go; one
// Undo puts it back where it was. A refusal anywhere leaves exactly one copy.

process.env.TZ = "Europe/Warsaw";

import { beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, renderHook } from "@testing-library/react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { clearUndo, undoDepth, undoLast } from "../commands/undo";
import type { CalendarAccountModel, CalendarEventModel } from "../events";
import type { CalendarModuleApi } from "../hooks/use-calendar-module";
import { useEventMove } from "./use-event-move";

const h = rs.hoisted(() => ({
  push: rs.fn(),
  toastError: rs.fn(),
  undoToast: rs.fn(() => "toast-1"),
}));
rs.mock("../google-web", () => ({ pushGoogleWebEvent: h.push }));
rs.mock("sonner", () => ({
  toast: Object.assign(rs.fn(), { error: h.toastError, dismiss: rs.fn() }),
}));
rs.mock("../../../lib/undo-toast", () => ({ undoToast: h.undoToast }));

const ME = "u-me";
const WS = "ws-1";

const NATIVE: CalendarEventModel = {
  id: "ev-a",
  workspaceId: WS,
  ownerId: ME,
  sourceAccountId: null,
  externalEventId: null,
  calendarId: "moduo",
  title: "Design review",
  description: "<p>Agenda</p>",
  startsAt: "2026-11-03T10:00:00.000Z",
  endsAt: "2026-11-03T11:00:00.000Z",
  allDay: false,
  rrule: null,
  status: "confirmed",
  location: null,
  color: null,
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
  deletedAt: null,
  attendees: [],
  isPrivate: false,
};

const WORK: CalendarAccountModel = {
  id: "acc-work",
  workspaceId: WS,
  ownerId: ME,
  provider: "google",
  externalId: "work@group.calendar.google.com",
  displayLabel: "Work",
  isDefaultTarget: false,
  color: null,
  lastSyncAt: null,
  status: "active",
  syncToken: null,
  deletedAt: null,
  readOnly: false,
};

const HOLIDAYS: CalendarAccountModel = { ...WORK, id: "acc-holidays", readOnly: true };

const GOOGLE_REPLY = {
  id: "g-123",
  summary: "Design review",
  description: "<p>Agenda</p>",
  start: { dateTime: "2026-11-03T10:00:00.000Z" },
  end: { dateTime: "2026-11-03T11:00:00.000Z" },
};

const MIRRORED: CalendarEventModel = {
  ...NATIVE,
  id: "ev-g",
  sourceAccountId: "acc-work",
  externalEventId: "g-123",
};

function setup(over: { removeFails?: boolean } = {}) {
  const state = { events: [NATIVE] as CalendarEventModel[] };
  const calendar = {
    get events() {
      return state.events;
    },
    accounts: [WORK, HOLIDAYS],
    reload: rs.fn(async () => {}),
    deleteEvent: rs.fn(async () => {}),
  };
  const runtime = {
    calendar: {
      mirrorEvents: rs.fn(async () => {
        state.events = [...state.events, MIRRORED];
      }),
      removeEvent: rs.fn(async () => {
        if (over.removeFails) throw new Error("Network down");
        state.events = state.events.filter((e) => e.id !== NATIVE.id);
      }),
      restoreEvent: rs.fn(async () => {
        state.events = [...state.events, NATIVE];
        return NATIVE;
      }),
    },
  };
  const hook = renderHook(() =>
    useEventMove(
      calendar as unknown as CalendarModuleApi,
      runtime as unknown as ModuoRuntime,
      WS,
      ME,
    ),
  );
  return { hook, calendar, runtime, state };
}

beforeEach(() => {
  clearUndo();
  h.push.mockReset();
  h.toastError.mockReset();
  h.undoToast.mockClear();
});

describe("useEventMove", () => {
  it("creates it on Google first, then removes the Moduo row, with one Undo", async () => {
    h.push.mockResolvedValue(GOOGLE_REPLY);
    const { hook, calendar, runtime, state } = setup();
    await act(async () => {
      await hook.result.current("ev-a", "acc-work");
    });

    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.push.mock.calls[0]![0]).toMatchObject({
      externalAccountId: WORK.externalId,
      title: "Design review",
      startsAt: NATIVE.startsAt,
      endsAt: NATIVE.endsAt,
      allDay: false,
      description: "<p>Agenda</p>",
    });
    expect(runtime.calendar.mirrorEvents).toHaveBeenCalledTimes(1);
    expect(runtime.calendar.mirrorEvents.mock.calls[0]![0]).toMatchObject({
      workspaceId: WS,
      accountId: "acc-work",
    });
    expect(runtime.calendar.removeEvent).toHaveBeenCalledWith({
      workspaceId: WS,
      eventId: "ev-a",
    });
    // Google's answer happened before the Moduo row went.
    const pushOrder = h.push.mock.invocationCallOrder[0]!;
    const removeOrder = runtime.calendar.removeEvent.mock.invocationCallOrder[0]!;
    expect(pushOrder).toBeLessThan(removeOrder);
    expect(calendar.reload).toHaveBeenCalled();
    expect(state.events.map((e) => e.id)).toEqual(["ev-g"]);
    expect(undoDepth()).toBe(1);
    expect(h.undoToast).toHaveBeenCalledTimes(1);
    expect(String((h.undoToast.mock.calls[0] as unknown[])[0])).toContain("Work");

    // Undo: the Google copy goes (quietly), the Moduo row comes back.
    await act(async () => {
      undoLast();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(calendar.deleteEvent).toHaveBeenCalledWith("ev-g", { quiet: true });
    expect(runtime.calendar.restoreEvent).toHaveBeenCalledWith({
      workspaceId: WS,
      eventId: "ev-a",
    });
  });

  it("Google refuses: nothing changes in Moduo, and the toast says why", async () => {
    h.push.mockRejectedValue(new Error("Google says no: rate limit"));
    const { hook, runtime } = setup();
    await act(async () => {
      await hook.result.current("ev-a", "acc-work");
    });
    expect(runtime.calendar.mirrorEvents).not.toHaveBeenCalled();
    expect(runtime.calendar.removeEvent).not.toHaveBeenCalled();
    expect(String(h.toastError.mock.calls[0]![0])).toContain("rate limit");
    expect(undoDepth()).toBe(0);
  });

  it("the Moduo row won't go: the Google copy is taken back, so one copy stays", async () => {
    h.push.mockResolvedValue(GOOGLE_REPLY);
    const { hook, calendar } = setup({ removeFails: true });
    await act(async () => {
      await hook.result.current("ev-a", "acc-work");
    });
    expect(calendar.deleteEvent).toHaveBeenCalledWith("ev-g", { quiet: true });
    expect(h.toastError).toHaveBeenCalled();
    expect(undoDepth()).toBe(0);
  });

  it("never moves where the menu wouldn't offer: a read-only calendar, a repeat", async () => {
    const { hook, runtime } = setup();
    await act(async () => {
      await hook.result.current("ev-a", "acc-holidays");
      await hook.result.current("missing", "acc-work");
    });
    expect(h.push).not.toHaveBeenCalled();
    expect(runtime.calendar.removeEvent).not.toHaveBeenCalled();
  });
});
