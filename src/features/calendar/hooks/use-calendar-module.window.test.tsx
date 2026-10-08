// SCALE-1: the fetch-window half of the calendar hook. These three behaviours
// are the ones the block's validator rounds actually broke — a stale window on
// the first read after a workspace switch, a double fetch on mount, and an
// `ensureAllTime` that silently does nothing (stranding the deep link that
// waits on it). Everything else about the hook is covered by its page tests.

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, renderHook, waitFor } from "@testing-library/react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { supabaseClient } from "../../../lib/runtime.web";
import { allTimeCalendarWindow, defaultCalendarWindow } from "../window";
import { useCalendarModule } from "./use-calendar-module";

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

describe("useCalendarModule — fetch window", () => {
  it("reads exactly once on mount, with the default window", async () => {
    const calls: Call[] = [];
    const runtime = fakeRuntime(calls);
    const { result } = renderHook(() => useCalendarModule(runtime, params("w1")));
    await waitFor(() => expect(result.current.loading).toBe(false));
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
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.ensureAllTime());
    await waitFor(() => expect(result.current.isAllTimeWindow).toBe(true));

    rerender({ ws: "w2" });
    await waitFor(() => expect(calls.some((c) => c.workspaceId === "w2")).toBe(true));

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
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isAllTimeWindow).toBe(false);

    act(() => result.current.ensureAllTime());
    await waitFor(() => expect(result.current.isAllTimeWindow).toBe(true));
    const after = calls.length;

    act(() => result.current.ensureAllTime());
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toHaveLength(after); // no reload → a caller must not wait for one
  });

  it("widening for an on-screen range is skipped when already covered", async () => {
    const calls: Call[] = [];
    const runtime = fakeRuntime(calls);
    const { result } = renderHook(() => useCalendarModule(runtime, params("w1")));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = calls.length;
    act(() => result.current.ensureRange(new Date(), new Date(Date.now() + 7 * 864e5)));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toHaveLength(before);
  });
});
