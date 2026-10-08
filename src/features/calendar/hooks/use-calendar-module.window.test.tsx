// SCALE-1: the fetch-window half of the calendar hook. These three behaviours
// are the ones the block's validator rounds actually broke — a stale window on
// the first read after a workspace switch, a double fetch on mount, and an
// `ensureAllTime` that silently does nothing (stranding the deep link that
// waits on it). Everything else about the hook is covered by its page tests.
// The busy overlay's lifecycle is pinned at the bottom.

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { supabaseClient } from "../../../lib/runtime.web";
import { allTimeCalendarWindow, defaultCalendarWindow } from "../window";
import { type CalendarModuleApi, useCalendarModule } from "./use-calendar-module";

type Call = { workspaceId: string; fromIso: string; toIso: string };

function fakeRuntime(calls: Call[]): ModuoRuntime {
  return {
    calendar: {
      listModule: rs.fn(
        async (workspaceId: string, window?: { fromIso: string; toIso: string }) => {
          calls.push({ workspaceId, fromIso: window!.fromIso, toIso: window!.toIso });
          return { events: [], accounts: [], degraded: false, truncated: [] };
        },
      ),
    },
  } as unknown as ModuoRuntime;
}

const params = (workspaceId: string) => ({
  userId: "u1",
  workspaceId,
  modulePermission: "edit" as const,
});

// The hook fetches the busy overlay straight from the Supabase client, not through the
// runtime faked above. Unstubbed, every test here called prod's `calendar_busy_blocks`, and
// a reply that landed after the test environment was torn down ran setBusy without a
// `window`, killing the worker: `bun run test` failed at random with every test passing.
beforeEach(() => {
  rs.spyOn(supabaseClient, "rpc").mockImplementation((() =>
    Promise.resolve({ data: [], error: null })) as never);
});

afterEach(() => {
  rs.restoreAllMocks();
});

/**
 * Wait for both reads. The busy overlay only starts once `loading` flips (it
 * must never hold the calendar up), so a test that stops at `loading` can end
 * with that reply still in flight — exactly where the flake hid.
 */
async function settled(result: { current: CalendarModuleApi }) {
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    await Promise.allSettled(rs.mocked(supabaseClient.rpc).mock.results.map((r) => r.value));
  });
}

describe("useCalendarModule — fetch window", () => {
  it("reads exactly once on mount, with the default window", async () => {
    const calls: Call[] = [];
    const runtime = fakeRuntime(calls);
    const { result } = renderHook(() => useCalendarModule(runtime, params("w1")));
    await settled(result);
    expect(calls).toHaveLength(1);
    // The busy overlay went to the stub, not the network.
    expect(supabaseClient.rpc).toHaveBeenCalledWith(
      "calendar_busy_blocks",
      expect.objectContaining({ p_workspace_id: "w1" }),
    );
    const expected = defaultCalendarWindow();
    // Same day either side of "now" — the exact ms differs per render.
    expect(calls[0].fromIso.slice(0, 10)).toBe(expected.fromIso.slice(0, 10));
    expect(calls[0].toIso.slice(0, 10)).toBe(expected.toIso.slice(0, 10));
  });

  it("never reads a new workspace with the previous one's widened window", async () => {
    const calls: Call[] = [];
    const runtime = fakeRuntime(calls);
    const { result, rerender } = renderHook(({ ws }) => useCalendarModule(runtime, params(ws)), {
      initialProps: { ws: "w1" },
    });
    await settled(result);

    act(() => result.current.ensureAllTime());
    await waitFor(() => expect(result.current.isAllTimeWindow).toBe(true));

    rerender({ ws: "w2" });
    await waitFor(() => expect(calls.some((c) => c.workspaceId === "w2")).toBe(true));
    await settled(result);

    const all = allTimeCalendarWindow();
    for (const call of calls.filter((c) => c.workspaceId === "w2")) {
      expect(call.fromIso).not.toBe(all.fromIso);
    }
    // ...and it only took one read to get there.
    expect(calls.filter((c) => c.workspaceId === "w2")).toHaveLength(1);
  });

  it("ensureAllTime is a no-op the second time — isAllTimeWindow is how callers tell", async () => {
    const calls: Call[] = [];
    const runtime = fakeRuntime(calls);
    const { result } = renderHook(() => useCalendarModule(runtime, params("w1")));
    await settled(result);
    expect(result.current.isAllTimeWindow).toBe(false);

    act(() => result.current.ensureAllTime());
    await waitFor(() => expect(result.current.isAllTimeWindow).toBe(true));
    await settled(result);
    const after = calls.length;

    act(() => result.current.ensureAllTime());
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toHaveLength(after); // no reload → a caller must not wait for one
  });

  it("widening for an on-screen range is skipped when already covered", async () => {
    const calls: Call[] = [];
    const runtime = fakeRuntime(calls);
    const { result } = renderHook(() => useCalendarModule(runtime, params("w1")));
    await settled(result);
    const before = calls.length;
    act(() => result.current.ensureRange(new Date(), new Date(Date.now() + 7 * 864e5)));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toHaveLength(before);
  });
});

describe("useCalendarModule — busy overlay", () => {
  type BusyReply = {
    data: { calendar_id: string; start_time: string; end_time: string }[] | null;
    error: { message: string } | null;
  };
  type Held = { resolve: (reply: BusyReply) => void; reject: (err: Error) => void };

  const BUSY: BusyReply = {
    data: [
      {
        calendar_id: "c1",
        start_time: "2026-10-08T09:00:00.000Z",
        end_time: "2026-10-08T10:00:00.000Z",
      },
    ],
    error: null,
  };

  /** Hold every busy RPC open, to settle by hand. */
  function holdBusy(): Held[] {
    const held: Held[] = [];
    rs.mocked(supabaseClient.rpc).mockImplementation(
      (() => new Promise<BusyReply>((resolve, reject) => held.push({ resolve, reject }))) as never,
    );
    return held;
  }

  /** Mount, let `loading` settle with the busy RPC still out, then unmount. */
  async function unmountMidBusy(): Promise<Held> {
    const held = holdBusy();
    const runtime = fakeRuntime([]);
    const { result, unmount } = renderHook(() => useCalendarModule(runtime, params("w1")));
    await waitFor(() => expect(result.current.loading).toBe(false));
    unmount();
    return held[0];
  }

  /**
   * Count React's `window.event` reads. It makes one for every setState, even
   * on an unmounted component, before it checks whether the component is
   * still there: the read that threw "window is not defined" after teardown.
   * A known-dead setState must trip it first, so the probe can't go vacuous.
   */
  function stateUpdateProbe() {
    const dead = renderHook(() => useState(0)[1]);
    const setDead = dead.result.current;
    dead.unmount();
    const reads = rs.spyOn(window, "event", "get");
    setDead(1);
    expect(reads).toHaveBeenCalled();
    reads.mockClear();
    return reads;
  }

  it("never holds loading up, and lands once its RPC replies", async () => {
    const held = holdBusy();
    const runtime = fakeRuntime([]);
    const { result } = renderHook(() => useCalendarModule(runtime, params("w1")));
    await waitFor(() => expect(result.current.loading).toBe(false)); // RPC still out
    expect(held).toHaveLength(1);
    await act(async () => held[0].resolve(BUSY));
    expect(result.current.events.map((e) => e.title)).toEqual(["Busy"]);
  });

  it("drops a reply that lands after unmount", async () => {
    const busy = await unmountMidBusy();
    const updates = stateUpdateProbe();
    await act(async () => busy.resolve(BUSY));
    expect(updates).not.toHaveBeenCalled();
  });

  it("drops a failure that lands after unmount", async () => {
    const busy = await unmountMidBusy();
    const updates = stateUpdateProbe();
    await act(async () => busy.reject(new Error("offline")));
    expect(updates).not.toHaveBeenCalled();
  });

  it("starts no read when reload() fires after unmount", async () => {
    const calls: Call[] = [];
    const runtime = fakeRuntime(calls);
    const { result, unmount } = renderHook(() => useCalendarModule(runtime, params("w1")));
    await settled(result);
    const { reload } = result.current;
    unmount();
    await reload(); // e.g. a calendar sync that finishes after the page is gone
    expect(calls).toHaveLength(1);
    expect(supabaseClient.rpc).toHaveBeenCalledTimes(1);
  });
});
