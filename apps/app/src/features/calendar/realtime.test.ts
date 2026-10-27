// CALR-7 · live events (specs/calendar-rethink.md AC42, hole K10): an event
// added, changed or deleted elsewhere (another device, ⇧⌘K capture, an
// assistant through MCP, a teammate whose calendar you can see) reaches the
// open week within seconds, without a reload; a reconnect or a return to the
// window refetches quietly. The socket is the runtime's (`calendar.listenLive`,
// runtime.web.calendar.live.test.ts); this pins the merge and the hook.

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, renderHook, waitFor } from "@testing-library/react";

import type { ModuoRuntime } from "../../lib/runtime.types";
import { supabaseClient } from "../../lib/runtime.web.client";
import type { CalendarEventModel, CalendarLiveEvent } from "./events";
import { useCalendarModule } from "./hooks/use-calendar-module";
import { applyLiveChange } from "./live";

rs.mock("../../lib/undo-toast", () => ({ undoToast: rs.fn() }));

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

describe("applyLiveChange", () => {
  const a = ev({ id: "a" });
  const b = ev({ id: "b", title: "Lunch" });

  it("adds an event it doesn't have", () => {
    const next = applyLiveChange([a], { kind: "upsert", event: b }, "w1");
    expect(next.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("replaces a newer (or same-time) version in place", () => {
    const moved = ev({ id: "a", title: "Standup (moved)", updatedAt: "2026-10-28T08:05:00Z" });
    expect(applyLiveChange([a, b], { kind: "upsert", event: moved }, "w1")).toEqual([moved, b]);
    const same = ev({ id: "a", title: "Same stamp", updatedAt: a.updatedAt });
    expect(applyLiveChange([a], { kind: "upsert", event: same }, "w1")[0]!.title).toBe(
      "Same stamp",
    );
  });

  it("keeps what it has when the change is older (a late echo)", () => {
    const current = [ev({ id: "a", title: "Newest", updatedAt: "2026-10-28T09:00:00Z" })];
    const stale = ev({ id: "a", title: "Old", updatedAt: "2026-10-28T08:00:00Z" });
    expect(applyLiveChange(current, { kind: "upsert", event: stale }, "w1")).toBe(current);
  });

  it("removes a soft-deleted event and a hard-deleted id", () => {
    const gone = ev({
      id: "a",
      deletedAt: "2026-10-28T09:00:00Z",
      updatedAt: "2026-10-28T09:00:00Z",
    });
    expect(applyLiveChange([a, b], { kind: "upsert", event: gone }, "w1").map((e) => e.id)).toEqual(
      ["b"],
    );
    expect(applyLiveChange([a, b], { kind: "delete", id: "b" }, "w1").map((e) => e.id)).toEqual([
      "a",
    ]);
  });

  it("returns the same list when nothing changes", () => {
    const list = [a];
    expect(applyLiveChange(list, { kind: "delete", id: "zzz" }, "w1")).toBe(list);
    const deletedElsewhere = ev({ id: "zzz", deletedAt: "2026-10-28T09:00:00Z" });
    expect(applyLiveChange(list, { kind: "upsert", event: deletedElsewhere }, "w1")).toBe(list);
  });

  it("ignores an event from another workspace", () => {
    const list = [a];
    const other = ev({ id: "x", workspaceId: "w2" });
    expect(applyLiveChange(list, { kind: "upsert", event: other }, "w1")).toBe(list);
  });
});

// ── The hook: the open store follows live changes ───────────────────────────

type Listen = { workspaceId: string; selfId: string; listener: (e: CalendarLiveEvent) => void };

function liveRuntime(initial: CalendarEventModel[]) {
  const listens: Listen[] = [];
  const stopped: string[] = [];
  const listModule = rs.fn(async () => ({
    events: initial,
    accounts: [],
    degraded: false,
    truncated: [],
  }));
  const runtime = {
    calendar: {
      listModule,
      listenLive: rs.fn(
        (
          input: { workspaceId: string; selfId: string },
          listener: (e: CalendarLiveEvent) => void,
        ) => {
          listens.push({ ...input, listener });
          return () => stopped.push(input.workspaceId);
        },
      ),
    },
  } as unknown as ModuoRuntime;
  return { runtime, listens, stopped, listModule };
}

beforeEach(() => {
  rs.spyOn(supabaseClient, "rpc").mockImplementation((() =>
    Promise.resolve({ data: [], error: null })) as never);
});

afterEach(() => {
  rs.restoreAllMocks();
});

const params = (workspaceId: string) => ({
  userId: "u1",
  workspaceId,
  modulePermission: "edit" as const,
});

describe("useCalendarModule — live events", () => {
  it("listens once per workspace as the signed-in person", async () => {
    const { runtime, listens } = liveRuntime([]);
    const { result } = renderHook(() => useCalendarModule(runtime, params("w1")));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listens).toHaveLength(1);
    expect(listens[0]).toMatchObject({ workspaceId: "w1", selfId: "u1" });
  });

  it("an insert, an update and a delete reach the open week without a reload", async () => {
    const { runtime, listens, listModule } = liveRuntime([ev({ id: "a" })]);
    const { result } = renderHook(() => useCalendarModule(runtime, params("w1")));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const emit = (e: CalendarLiveEvent) => act(() => listens.at(-1)!.listener(e));
    const reads = listModule.mock.calls.length;

    emit({ type: "change", change: { kind: "upsert", event: ev({ id: "b", title: "From MCP" }) } });
    expect(result.current.events.map((e) => e.title)).toEqual(["Standup", "From MCP"]);

    emit({
      type: "change",
      change: {
        kind: "upsert",
        event: ev({ id: "a", title: "Moved on my phone", updatedAt: "2026-10-28T08:10:00Z" }),
      },
    });
    expect(result.current.events.find((e) => e.id === "a")?.title).toBe("Moved on my phone");

    emit({ type: "change", change: { kind: "delete", id: "b" } });
    expect(result.current.events.map((e) => e.id)).toEqual(["a"]);
    expect(listModule.mock.calls.length).toBe(reads);
  });

  it("a resync refetches quietly, and a burst of them refetches once", async () => {
    const { runtime, listens, listModule } = liveRuntime([ev({ id: "a" })]);
    const { result } = renderHook(() => useCalendarModule(runtime, params("w1")));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const reads = listModule.mock.calls.length;
    const seenLoading: boolean[] = [];

    await act(async () => {
      listens.at(-1)!.listener({ type: "resync", reason: "return" });
      listens.at(-1)!.listener({ type: "resync", reason: "return" });
      listens.at(-1)!.listener({ type: "resync", reason: "reconnect" });
      seenLoading.push(result.current.loading);
    });
    await waitFor(() => expect(listModule.mock.calls.length).toBe(reads + 1));
    seenLoading.push(result.current.loading);
    expect(seenLoading).toEqual([false, false]);
  });

  it("stops listening on a workspace switch and on unmount", async () => {
    const { runtime, listens, stopped } = liveRuntime([]);
    const { result, rerender, unmount } = renderHook(
      ({ ws }: { ws: string }) => useCalendarModule(runtime, params(ws)),
      { initialProps: { ws: "w1" } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ ws: "w2" });
    await waitFor(() => expect(listens.at(-1)?.workspaceId).toBe("w2"));
    expect(stopped).toEqual(["w1"]);

    // A late change from the workspace you left never lands in this one.
    act(() =>
      listens[0]!.listener({
        type: "change",
        change: { kind: "upsert", event: ev({ id: "late", workspaceId: "w1" }) },
      }),
    );
    expect(result.current.events.some((e) => e.id === "late")).toBe(false);

    unmount();
    expect(stopped).toEqual(["w1", "w2"]);
  });

  it("keeps working on a runtime without live events", async () => {
    const { runtime } = liveRuntime([ev({ id: "a" })]);
    delete (runtime.calendar as { listenLive?: unknown }).listenLive;
    const { result } = renderHook(() => useCalendarModule(runtime, params("w1")));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.events.map((e) => e.id)).toEqual(["a"]);
  });
});
