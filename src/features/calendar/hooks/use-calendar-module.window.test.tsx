// SCALE-1: the fetch-window half of the calendar hook. These three behaviours
// are the ones the block's validator rounds actually broke — a stale window on
// the first read after a workspace switch, a double fetch on mount, and an
// `ensureAllTime` that silently does nothing (stranding the deep link that
// waits on it). The middle blocks pin that edits and deletes reach the
// server and what a workspace switch leaves behind; the busy overlay's
// lifecycle is pinned at the bottom. There are no page-level calendar tests.

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";

import type { Truncation } from "../../../lib/paged-select";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { supabaseClient } from "../../../lib/runtime.web";
import type { CalendarAccountModel, CalendarEventModel, CalendarModuleBundle } from "../events";
import { allTimeCalendarWindow, defaultCalendarWindow } from "../window";
import { type CalendarModuleApi, useCalendarModule } from "./use-calendar-module";

const h = rs.hoisted(() => ({ undoToast: rs.fn() }));
rs.mock("../../../lib/undo-toast", () => ({ undoToast: h.undoToast }));

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

// Shared by the two blocks below: real event rows, and a runtime whose writes
// stay open until a test settles them.
type Held = {
  args: { workspaceId: string };
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};
type Writes = Record<"create" | "update" | "remove" | "restore", Held[]>;

const DRAFT = {
  title: "Standup",
  startsAt: "2026-10-08T09:00:00.000Z",
  endsAt: "2026-10-08T09:30:00.000Z",
};
const CAP: Truncation = { scope: "events", shown: 2000, total: 2400 };

const event = (id: string, workspaceId: string): CalendarEventModel => ({
  id,
  workspaceId,
  ownerId: "u1",
  sourceAccountId: null,
  externalEventId: null,
  calendarId: "moduo",
  title: id,
  description: "",
  startsAt: "2026-10-08T11:00:00.000Z",
  endsAt: "2026-10-08T12:00:00.000Z",
  allDay: false,
  rrule: null,
  status: "confirmed",
  color: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  deletedAt: null,
});

const account = (id: string, workspaceId: string): CalendarAccountModel => ({
  id,
  workspaceId,
  ownerId: "u1",
  provider: "google",
  externalId: `${id}@example.com`,
  displayLabel: id,
  isDefaultTarget: false,
  color: null,
  lastSyncAt: null,
  status: "ok",
  syncToken: null,
  deletedAt: null,
});

/**
 * Each workspace's read (a pending promise holds it open), and every write
 * held open to settle by hand.
 */
function heldRuntime(
  reads: Record<string, Partial<CalendarModuleBundle> | Promise<Partial<CalendarModuleBundle>>>,
) {
  const writes: Writes = { create: [], update: [], remove: [], restore: [] };
  const held = (list: Held[]) =>
    rs.fn(
      (args: Held["args"]) =>
        new Promise((resolve, reject) => list.push({ args, resolve, reject })),
    );
  const runtime = {
    calendar: {
      listModule: rs.fn(async (workspaceId: string) => ({
        events: [],
        accounts: [],
        degraded: false,
        truncated: [],
        ...(await reads[workspaceId]),
      })),
      createEvent: held(writes.create),
      updateEvent: held(writes.update),
      removeEvent: held(writes.remove),
      restoreEvent: held(writes.restore),
    },
  } as unknown as ModuoRuntime;
  return { runtime, writes };
}

/** Mounted on w1 with edit access, its first read settled; rerender to switch. */
async function mountOnW1(runtime: ModuoRuntime) {
  const hook = renderHook(({ ws }) => useCalendarModule(runtime, params(ws)), {
    initialProps: { ws: "w1" },
  });
  await settled(hook.result);
  return hook;
}

/** The list's ids, with a still-saving create's random id shown as `tmp`. */
const rows = (result: { current: CalendarModuleApi }) =>
  result.current.events.map((e) => (e.id.startsWith("tmp-") ? "tmp" : e.id));

const readsOf = (runtime: ModuoRuntime) =>
  rs.mocked(runtime.calendar.listModule).mock.calls.map(([workspaceId]) => workspaceId);

describe("useCalendarModule — edits and deletes", () => {
  // The calendar page sets its own state in the same handler before it calls
  // these (confirmDelete clears four pieces first). React then runs the hook's
  // state updater later, at render, so a snapshot taken inside it was still
  // empty when the hook decided whether to send the write, and it never did.
  /** The hook plus another piece of state on the same component, like the page. */
  function mountWithOtherState(runtime: ModuoRuntime) {
    return renderHook(() => {
      const [, bump] = useState(0);
      return { ...useCalendarModule(runtime, params("w1")), bump };
    });
  }

  it("sends a delete even when the component has other state queued first", async () => {
    const { runtime, writes } = heldRuntime({
      w1: { events: [event("e1", "w1"), event("e2", "w1")] },
    });
    const { result } = mountWithOtherState(runtime);
    await settled(result);

    act(() => {
      result.current.bump((n) => n + 1); // what confirmDelete does first
      void result.current.deleteEvent("e1");
    });
    expect(writes.remove.map((w) => w.args)).toEqual([{ workspaceId: "w1", eventId: "e1" }]);
    expect(rows(result)).toEqual(["e2"]);
  });

  it("sends an edit even when the component has other state queued first", async () => {
    const { runtime, writes } = heldRuntime({ w1: { events: [event("e1", "w1")] } });
    const { result } = mountWithOtherState(runtime);
    await settled(result);

    act(() => {
      result.current.bump((n) => n + 1);
      void result.current.updateEvent("e1", { title: "Renamed" });
    });
    expect(writes.update.map((w) => w.args)).toEqual([
      { workspaceId: "w1", eventId: "e1", patch: { title: "Renamed" } },
    ]);
    expect(result.current.events.map((e) => e.title)).toEqual(["Renamed"]);

    await act(async () => writes.update[0].reject(new Error("offline")));
    expect(result.current.events.map((e) => e.title)).toEqual(["e1"]); // rolled back
  });
});

describe("useCalendarModule — workspace switch", () => {
  it("shows none of the old workspace's rows while the new one is still loading", async () => {
    let releaseW2 = () => {};
    const w2Read = new Promise<Partial<CalendarModuleBundle>>((resolve) => {
      releaseW2 = () => resolve({ events: [event("e2", "w2")] });
    });
    const { runtime } = heldRuntime({
      w1: { events: [event("e1", "w1")], accounts: [account("a1", "w1")], truncated: [CAP] },
      w2: w2Read,
    });
    // What the page's effects see in each commit, the switch's own included:
    // the `?event=` deep link and the Google linker act on that one.
    const commits: {
      ws: string;
      loading: boolean;
      rows: number;
      accounts: number;
      notices: number;
    }[] = [];
    const { result, rerender } = renderHook(
      ({ ws }) => {
        const api = useCalendarModule(runtime, params(ws));
        useEffect(() => {
          commits.push({
            ws,
            loading: api.loading,
            rows: api.events.length,
            accounts: api.accounts.length,
            notices: api.truncated.length,
          });
        });
        return api;
      },
      { initialProps: { ws: "w1" } },
    );
    await settled(result);
    expect(rows(result)).toEqual(["e1"]);

    rerender({ ws: "w2" });
    expect(commits.find((c) => c.ws === "w2")).toEqual({
      ws: "w2",
      loading: true,
      rows: 0,
      accounts: 0,
      notices: 0,
    });
    expect(rows(result)).toEqual([]);

    await act(async () => releaseW2());
    await settled(result);
    expect(rows(result)).toEqual(["e2"]);
  });

  it("leaves a create still saving in w1 behind, and it still saves to w1", async () => {
    const { runtime, writes } = heldRuntime({ w2: { events: [event("e2", "w2")] } });
    const { result, rerender } = await mountOnW1(runtime);
    act(() => void result.current.createEvent(DRAFT));
    expect(rows(result)).toEqual(["tmp"]);

    rerender({ ws: "w2" });
    await settled(result);
    expect(rows(result)).toEqual(["e2"]); // the pending row didn't ride along

    await act(async () => writes.create[0].resolve(event("saved", "w1")));
    expect(rows(result)).toEqual(["e2"]); // ...and neither did the saved one
    expect(writes.create[0].args.workspaceId).toBe("w1");
  });

  it("keeps a create still saving through a same-workspace reload", async () => {
    const { runtime, writes } = heldRuntime({ w1: { events: [event("e1", "w1")] } });
    const { result } = await mountOnW1(runtime);
    act(() => void result.current.createEvent(DRAFT));

    act(() => result.current.ensureAllTime()); // a wider window, same workspace → reload
    await settled(result);
    expect(readsOf(runtime)).toEqual(["w1", "w1"]);
    expect(rows(result)).toEqual(["e1", "tmp"]);

    await act(async () => writes.create[0].resolve(event("saved", "w1")));
    expect(rows(result)).toEqual(["e1", "saved"]);
  });

  it("an update that settles after the switch leaves the new list alone", async () => {
    const { runtime, writes } = heldRuntime({
      w1: { events: [event("e1", "w1")] },
      w2: { events: [event("e2", "w2")] },
    });
    const { result, rerender } = await mountOnW1(runtime);
    act(() => void result.current.updateEvent("e1", { title: "Renamed" }));

    rerender({ ws: "w2" });
    await settled(result);
    const before = result.current.events;
    await act(async () => writes.update[0].resolve({ ...event("e1", "w1"), title: "Renamed" }));
    expect(result.current.events).toBe(before); // not even re-rendered
    expect(writes.update[0].args.workspaceId).toBe("w1");
  });

  it("a delete that fails after the switch doesn't put its row back into the new list", async () => {
    const { runtime, writes } = heldRuntime({
      w1: { events: [event("e1", "w1")] },
      w2: { events: [event("e2", "w2")] },
    });
    const { result, rerender } = await mountOnW1(runtime);
    act(() => void result.current.deleteEvent("e1"));
    expect(rows(result)).toEqual([]);

    rerender({ ws: "w2" });
    await settled(result);
    await act(async () => writes.remove[0].reject(new Error("offline")));
    expect(rows(result)).toEqual(["e2"]);
  });

  it("Undo after the switch restores the event in w1, not into the new list", async () => {
    h.undoToast.mockClear();
    const { runtime, writes } = heldRuntime({
      w1: { events: [event("e1", "w1")] },
      w2: { events: [event("e2", "w2")] },
    });
    const { result, rerender } = await mountOnW1(runtime);
    act(() => void result.current.deleteEvent("e1"));
    await act(async () => writes.remove[0].resolve(undefined));
    const { onUndo } = h.undoToast.mock.calls[0][1] as { onUndo: () => void };

    rerender({ ws: "w2" });
    await settled(result);
    act(() => onUndo());
    await act(async () => writes.restore[0].resolve(event("e1", "w1")));
    expect(writes.restore[0].args.workspaceId).toBe("w1");
    expect(rows(result)).toEqual(["e2"]);
  });

  it("a reload kept from before the switch reads the new workspace, never the old one", async () => {
    const { runtime } = heldRuntime({
      w1: { events: [event("e1", "w1")] },
      w2: { events: [event("e2", "w2")] },
    });
    const { result, rerender } = await mountOnW1(runtime);
    const { reload } = result.current; // e.g. a calendar sync that started on w1

    rerender({ ws: "w2" });
    await settled(result);
    await act(async () => reload());
    await settled(result);
    expect(readsOf(runtime)).toEqual(["w1", "w2", "w2"]);
    expect(rows(result)).toEqual(["e2"]);
  });

  it.each([
    ["read access goes away", { permission: "none" }],
    ["the user is signed out", { userId: null }],
  ] as const)(
    "clears the list and its notices when %s, and a create still saving stays out",
    async (_when, change) => {
      const { runtime, writes } = heldRuntime({
        w1: { events: [event("e1", "w1")], degraded: true, truncated: [CAP] },
      });
      type Props = { permission: "edit" | "none"; userId: string | null };
      const { result, rerender } = renderHook(
        ({ permission, userId }: Props) =>
          useCalendarModule(runtime, { userId, workspaceId: "w1", modulePermission: permission }),
        { initialProps: { permission: "edit", userId: "u1" } as Props },
      );
      await settled(result);
      expect(result.current.truncated).toEqual([CAP]);
      expect(result.current.degraded).toBe(true);
      act(() => void result.current.createEvent(DRAFT));

      rerender({ permission: "edit", userId: "u1", ...change });
      expect(rows(result)).toEqual([]);
      expect(result.current.truncated).toEqual([]);
      expect(result.current.degraded).toBe(false);
      expect(result.current.loading).toBe(false);

      await act(async () => writes.create[0].resolve(event("saved", "w1")));
      expect(rows(result)).toEqual([]);
    },
  );
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
