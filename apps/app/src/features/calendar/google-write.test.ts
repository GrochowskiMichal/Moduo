// CALR-8 · Google two-way, the app half (specs/calendar-rethink.md AC43):
// a Google event you connected edits like your own. The edit shows at once,
// saves to Google first (the runtime's updateGoogleEvent / removeGoogleEvent:
// Google, then the mirror stores Google's answer), and when Google refuses,
// the change rolls back with a toast that says why. Events from view-only
// accounts (Outlook, CalDAV, .ics) and other people's accounts stay read-only.

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, renderHook, waitFor } from "@testing-library/react";

import type { ModuoRuntime } from "../../lib/runtime.types";
import { supabaseClient } from "../../lib/runtime.web.client";
import type { CalendarAccountModel, CalendarEventModel } from "./events";
import { readFunctionError } from "./google-web";
import { useCalendarModule } from "./hooks/use-calendar-module";
import { mapGoogleEvent } from "./mirror";
import { writableEvent } from "./writable";

const h = rs.hoisted(() => ({
  toastError: rs.fn(),
  toastSuccess: rs.fn(),
  undoToast: rs.fn(),
}));
rs.mock("sonner", () => ({
  toast: Object.assign(rs.fn(), { error: h.toastError, success: h.toastSuccess }),
}));
rs.mock("../../lib/undo-toast", () => ({ undoToast: h.undoToast }));

function account(over: Partial<CalendarAccountModel> & { id: string }): CalendarAccountModel {
  return {
    workspaceId: "w1",
    ownerId: "u1",
    provider: "google",
    externalId: "google:me@x.com",
    displayLabel: "me@x.com",
    isDefaultTarget: false,
    color: null,
    lastSyncAt: null,
    status: "ok",
    syncToken: null,
    deletedAt: null,
    ...over,
  };
}

function ev(over: Partial<CalendarEventModel> & { id: string }): CalendarEventModel {
  return {
    workspaceId: "w1",
    ownerId: "u1",
    sourceAccountId: null,
    externalEventId: null,
    calendarId: "moduo",
    title: "Standup",
    description: "",
    startsAt: "2026-11-05T09:00:00Z",
    endsAt: "2026-11-05T09:30:00Z",
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

const GOOGLE = account({ id: "acc-g" });
const OUTLOOK = account({ id: "acc-o", provider: "microsoft", externalId: "microsoft:me@x.com" });
const THEIRS = account({ id: "acc-t", ownerId: "kai" });
const NATIVE = ev({ id: "native" });
const G_EVENT = ev({
  id: "g-row",
  sourceAccountId: "acc-g",
  externalEventId: "g1",
  calendarId: "google:me@x.com:primary",
  title: "Board",
});
const O_EVENT = ev({
  id: "o-row",
  sourceAccountId: "acc-o",
  externalEventId: "o1",
  title: "Outlook",
});

describe("writableEvent", () => {
  it("names how an event saves: in Moduo, through Google, or not at all", () => {
    const accounts = [GOOGLE, OUTLOOK, THEIRS];
    expect(writableEvent(NATIVE, accounts, "u1")).toBe("moduo");
    expect(writableEvent(G_EVENT, accounts, "u1")).toBe("google");
    expect(writableEvent(O_EVENT, accounts, "u1")).toBeNull();
    expect(writableEvent(ev({ id: "x", sourceAccountId: "acc-t" }), accounts, "u1")).toBeNull();
    expect(writableEvent(ev({ id: "y", sourceAccountId: "gone" }), accounts, "u1")).toBeNull();
    expect(
      writableEvent(
        ev({ id: "z", sourceAccountId: "acc-g", externalEventId: null }),
        accounts,
        "u1",
      ),
    ).toBeNull();
  });
});

describe("mapGoogleEvent: privacy and guests (CALR-8)", () => {
  const timed = {
    id: "g1",
    summary: "Board",
    start: { dateTime: "2026-11-05T10:00:00Z" },
    end: { dateTime: "2026-11-05T11:00:00Z" },
  };

  it("reads private and confidential as private", () => {
    expect(mapGoogleEvent({ ...timed, visibility: "private" })?.isPrivate).toBe(true);
    expect(mapGoogleEvent({ ...timed, visibility: "confidential" })?.isPrivate).toBe(true);
    expect(mapGoogleEvent({ ...timed, visibility: "default" })?.isPrivate).toBe(false);
    expect(mapGoogleEvent(timed)?.isPrivate).toBe(false);
  });

  it("maps guests with their replies, and no guests as an empty list", () => {
    expect(
      mapGoogleEvent({
        ...timed,
        attendees: [
          { email: "priya@example.com", displayName: "Priya", responseStatus: "accepted" },
          { email: "me@x.com", self: true, responseStatus: "needsAction" },
          { displayName: "no email" },
        ],
      })?.attendees,
    ).toEqual([
      { email: "priya@example.com", name: "Priya", status: "accepted" },
      { email: "me@x.com", name: "", status: "needsAction", self: true },
    ]);
    expect(mapGoogleEvent(timed)?.attendees).toEqual([]);
  });
});

describe("readFunctionError", () => {
  it("reads the function's own reason from its answer", async () => {
    const error = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      context: new Response(
        JSON.stringify({ error: "You need to have writer access to this calendar." }),
        {
          status: 409,
        },
      ),
    });
    expect(await readFunctionError(error)).toBe("You need to have writer access to this calendar.");
  });

  it("falls back to the error's message", async () => {
    expect(await readFunctionError(new Error("Failed to send a request"))).toBe(
      "Failed to send a request",
    );
    const notJson = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      context: new Response("<html>bad gateway</html>", { status: 502 }),
    });
    expect(await readFunctionError(notJson)).toBe("Edge Function returned a non-2xx status code");
  });
});

// ── The hook: Google-first edits with rollback ──────────────────────────────

function googleRuntime() {
  const calendar = {
    listModule: rs.fn(async () => ({
      events: [NATIVE, G_EVENT, O_EVENT],
      accounts: [GOOGLE, OUTLOOK],
      degraded: false,
      truncated: [],
    })),
    updateEvent: rs.fn(),
    removeEvent: rs.fn(),
    updateGoogleEvent: rs.fn(
      async (input: { event: CalendarEventModel; patch: { title?: string } }) => ({
        ...input.event,
        title: input.patch.title ?? input.event.title,
        updatedAt: "2026-10-28T09:00:00Z",
      }),
    ),
    removeGoogleEvent: rs.fn(async (_input: { event: CalendarEventModel }) => {}),
  };
  return { runtime: { calendar } as unknown as ModuoRuntime, calendar };
}

const params = { userId: "u1", workspaceId: "w1", modulePermission: "edit" as const };

beforeEach(() => {
  h.toastError.mockReset();
  rs.spyOn(supabaseClient, "rpc").mockImplementation((() =>
    Promise.resolve({ data: [], error: null })) as never);
});

afterEach(() => {
  rs.restoreAllMocks();
});

describe("useCalendarModule — Google events", () => {
  it("an edit to a Google event saves through Google, not the Moduo op", async () => {
    const { runtime, calendar } = googleRuntime();
    const { result } = renderHook(() => useCalendarModule(runtime, params));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateEvent("g-row", { title: "Board (moved)" });
    });
    expect(calendar.updateEvent).not.toHaveBeenCalled();
    expect(calendar.updateGoogleEvent).toHaveBeenCalledTimes(1);
    expect(calendar.updateGoogleEvent.mock.calls[0]![0]).toMatchObject({
      workspaceId: "w1",
      event: { id: "g-row", externalEventId: "g1", calendarId: "google:me@x.com:primary" },
      account: { id: "acc-g" },
      patch: { title: "Board (moved)" },
    });
    expect(result.current.events.find((e) => e.id === "g-row")?.title).toBe("Board (moved)");
  });

  it("shows the edit at once, and rolls it back with Google's reason when Google refuses", async () => {
    const { runtime, calendar } = googleRuntime();
    let refuse!: (err: Error) => void;
    calendar.updateGoogleEvent.mockImplementationOnce(
      () => new Promise((_, reject) => (refuse = reject)) as never,
    );
    const { result } = renderHook(() => useCalendarModule(runtime, params));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let saving!: Promise<void>;
    act(() => {
      saving = result.current.updateEvent("g-row", { title: "Renamed" });
    });
    expect(result.current.events.find((e) => e.id === "g-row")?.title).toBe("Renamed");
    await act(async () => {
      refuse(new Error("You need to have writer access to this calendar."));
      await saving;
    });
    expect(result.current.events.find((e) => e.id === "g-row")?.title).toBe("Board");
    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(String(h.toastError.mock.calls[0]![0])).toContain("writer access");
  });

  it("a delete goes to Google, and comes back when Google refuses", async () => {
    const { runtime, calendar } = googleRuntime();
    const { result } = renderHook(() => useCalendarModule(runtime, params));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteEvent("g-row");
    });
    expect(calendar.removeEvent).not.toHaveBeenCalled();
    expect(calendar.removeGoogleEvent).toHaveBeenCalledTimes(1);
    expect(calendar.removeGoogleEvent.mock.calls[0]![0]).toMatchObject({
      workspaceId: "w1",
      event: { id: "g-row" },
      account: { id: "acc-g" },
    });
    expect(result.current.events.some((e) => e.id === "g-row")).toBe(false);

    const second = googleRuntime();
    second.calendar.removeGoogleEvent.mockRejectedValueOnce(new Error("Forbidden"));
    const { result: again } = renderHook(() => useCalendarModule(second.runtime, params));
    await waitFor(() => expect(again.current.loading).toBe(false));
    await act(async () => {
      await again.current.deleteEvent("g-row");
    });
    expect(again.current.events.some((e) => e.id === "g-row")).toBe(true);
    expect(String(h.toastError.mock.calls.at(-1)![0])).toContain("Forbidden");
  });

  it("a view-only account's event doesn't change and nothing is sent", async () => {
    const { runtime, calendar } = googleRuntime();
    const { result } = renderHook(() => useCalendarModule(runtime, params));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.updateEvent("o-row", { title: "Nope" });
      await result.current.deleteEvent("o-row");
    });
    expect(calendar.updateEvent).not.toHaveBeenCalled();
    expect(calendar.updateGoogleEvent).not.toHaveBeenCalled();
    expect(calendar.removeEvent).not.toHaveBeenCalled();
    expect(calendar.removeGoogleEvent).not.toHaveBeenCalled();
    expect(result.current.events.find((e) => e.id === "o-row")?.title).toBe("Outlook");
    expect(h.toastError).toHaveBeenCalled();
  });

  it("native events still save through the Moduo op", async () => {
    const { runtime, calendar } = googleRuntime();
    calendar.updateEvent.mockImplementation(async () => ({ ...NATIVE, title: "Daily" }));
    const { result } = renderHook(() => useCalendarModule(runtime, params));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.updateEvent("native", { title: "Daily" });
    });
    expect(calendar.updateEvent).toHaveBeenCalledTimes(1);
    expect(calendar.updateGoogleEvent).not.toHaveBeenCalled();
  });
});
