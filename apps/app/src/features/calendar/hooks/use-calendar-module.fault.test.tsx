// AC2 / H2: a read that fails after the week has loaded keeps what the week
// shows (and says it's degraded) instead of emptying it into "Nothing
// scheduled".

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, renderHook, waitFor } from "@testing-library/react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { supabaseClient } from "../../../lib/runtime.web.client";
import type { CalendarAccountModel, CalendarEventModel, CalendarModuleBundle } from "../events";
import { useCalendarModule } from "./use-calendar-module";

const event: CalendarEventModel = {
  id: "e1",
  workspaceId: "w1",
  ownerId: "u1",
  sourceAccountId: null,
  externalEventId: null,
  calendarId: "moduo",
  title: "Board prep",
  description: "",
  startsAt: new Date().toISOString(),
  endsAt: new Date(Date.now() + 3_600_000).toISOString(),
  allDay: false,
  rrule: null,
  status: "confirmed",
  color: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  deletedAt: null,
};

const account: CalendarAccountModel = {
  id: "work",
  workspaceId: "w1",
  ownerId: "u1",
  provider: "google",
  externalId: "google:robin.hale@gmail.com:work",
  displayLabel: "Work",
  isDefaultTarget: false,
  color: null,
  lastSyncAt: null,
  status: "ok",
  syncToken: null,
  deletedAt: null,
};

beforeEach(() => {
  rs.spyOn(supabaseClient, "rpc").mockImplementation((() =>
    Promise.resolve({ data: [], error: null })) as never);
});

afterEach(() => {
  rs.restoreAllMocks();
});

describe("a failed read keeps the week", () => {
  it("keeps the events and accounts it had, and reports degraded", async () => {
    const replies: CalendarModuleBundle[] = [
      { events: [event], accounts: [account], degraded: false, truncated: [] },
      { events: [], accounts: [], degraded: true, truncated: [] },
    ];
    const runtime = {
      calendar: { listModule: rs.fn(async () => replies.shift()!) },
    } as unknown as ModuoRuntime;
    const { result } = renderHook(() =>
      useCalendarModule(runtime, { userId: "u1", workspaceId: "w1", modulePermission: "edit" }),
    );
    await waitFor(() => expect(result.current.events.map((e) => e.id)).toEqual(["e1"]));

    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.degraded).toBe(true);
    expect(result.current.events.map((e) => e.id)).toEqual(["e1"]);
    expect(result.current.accounts.map((a) => a.id)).toEqual(["work"]);
  });

  it("a first read that fails is still empty, and degraded", async () => {
    const runtime = {
      calendar: {
        listModule: rs.fn(async () => ({
          events: [],
          accounts: [],
          degraded: true,
          truncated: [],
        })),
      },
    } as unknown as ModuoRuntime;
    const { result } = renderHook(() =>
      useCalendarModule(runtime, { userId: "u1", workspaceId: "w1", modulePermission: "edit" }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.degraded).toBe(true);
    expect(result.current.events).toEqual([]);
  });
});
