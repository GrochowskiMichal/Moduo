// Coming back to Calendar from another module draws the week this session
// already read, at once, and refreshes it quietly: no skeleton (`loading`
// stays false) and no empty first frame. Another person, or a workspace never
// read, still starts empty and loading.

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { renderHook, waitFor } from "@testing-library/react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { supabaseClient } from "../../../lib/runtime.web.client";
import type { CalendarEventModel, CalendarModuleBundle } from "../events";
import { useCalendarModule } from "./use-calendar-module";

function event(id: string, title: string): CalendarEventModel {
  return {
    id,
    workspaceId: "w1",
    ownerId: "u1",
    sourceAccountId: null,
    externalEventId: null,
    calendarId: "moduo",
    title,
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
}

beforeEach(() => {
  rs.spyOn(supabaseClient, "rpc").mockImplementation((() =>
    Promise.resolve({ data: [], error: null })) as never);
});

afterEach(() => {
  rs.restoreAllMocks();
});

function runtimeReplying(replies: CalendarModuleBundle[]) {
  const listModule = rs.fn(async () => replies.shift() ?? replies[0]);
  return { runtime: { calendar: { listModule } } as unknown as ModuoRuntime, listModule };
}

const params = { userId: "u1", workspaceId: "w1", modulePermission: "edit" as const };

describe("coming back to Calendar", () => {
  it("draws the last week at once and refreshes it quietly", async () => {
    const first = runtimeReplying([
      { events: [event("e1", "Board prep")], accounts: [], degraded: false, truncated: [] },
    ]);
    const visit = renderHook(() => useCalendarModule(first.runtime, params));
    await waitFor(() => expect(visit.result.current.events.map((e) => e.id)).toEqual(["e1"]));
    visit.unmount();

    // Away in Tasks, then back: the first frame already has the week.
    const second = runtimeReplying([
      {
        events: [event("e1", "Board prep"), event("e2", "Investor call")],
        accounts: [],
        degraded: false,
        truncated: [],
      },
    ]);
    const back = renderHook(() => useCalendarModule(second.runtime, params));
    expect(back.result.current.loading).toBe(false);
    expect(back.result.current.events.map((e) => e.id)).toEqual(["e1"]);
    // …and the quiet refresh lands without a skeleton in between.
    await waitFor(() => expect(back.result.current.events.map((e) => e.id)).toEqual(["e1", "e2"]));
    expect(back.result.current.loading).toBe(false);
    expect(second.listModule).toHaveBeenCalledTimes(1);
  });

  it("another person signed in on this device starts empty", async () => {
    const first = runtimeReplying([
      { events: [event("e1", "Board prep")], accounts: [], degraded: false, truncated: [] },
    ]);
    const visit = renderHook(() => useCalendarModule(first.runtime, params));
    await waitFor(() => expect(visit.result.current.events).toHaveLength(1));
    visit.unmount();

    const other = runtimeReplying([{ events: [], accounts: [], degraded: false, truncated: [] }]);
    const theirs = renderHook(() => useCalendarModule(other.runtime, { ...params, userId: "u2" }));
    expect(theirs.result.current.events).toEqual([]);
    expect(theirs.result.current.loading).toBe(true);
  });
});
