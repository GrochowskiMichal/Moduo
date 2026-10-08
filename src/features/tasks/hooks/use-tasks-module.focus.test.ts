import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";

import { DEFAULT_FOCUS_PREFS, type FocusPrefs } from "../../../lib/focus-prefs";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import {
  __resetFocusEngineForTest,
  attachFocusUser,
  createFocusEngine,
  FOCUS_STORAGE_PREFIX,
  flushFocusSession,
  registerFocusFlushSink,
} from "../../focus/engine";
import { blankRecord, parseRecord } from "../../focus/engine-core";
import type { SavedTaskTime } from "../focus-time-write";
import { makeTask } from "../helpers";
import type { Task, TasksModuleBundle } from "../model";
import { useTasksModule } from "./use-tasks-module";

// The narrow time write goes to the test's in-memory "server".
const h = rs.hoisted(() => ({
  write: null as null | ((id: string, ws: string, total: number) => Promise<SavedTaskTime | null>),
}));
rs.mock("../focus-time-write", () => ({
  writeTaskTimeTotal: (id: string, ws: string, total: number) => {
    if (!h.write) throw new Error("no fake server");
    return h.write(id, ws, total);
  },
}));

// Live updates (TV-D5) need a socket; these tests drive the hook without one.
rs.mock("../realtime", () => ({ listenTasksLive: () => () => {} }));

// The Focus engine's flush sink (TV-F1, F1-7): every answer it gives decides
// whether tracked seconds are kept, retried or saved — never silently lost.

const USER = "u1";
const WS = "ws-1";
const KEY = `${FOCUS_STORAGE_PREFIX}${USER}`;

function task(id: string, timeSpentSeconds = 0, workspaceId = WS): Task {
  return {
    ...makeTask({ workspaceId, bucketId: "b1", title: id, position: "a0" }),
    id,
    timeSpentSeconds,
    updatedAt: "2026-10-08T10:00:00.000Z",
  };
}

function bundleOf(
  tasks: Task[],
  truncated: TasksModuleBundle["truncated"] = [],
): TasksModuleBundle {
  return { buckets: [], tasks, tags: [], tagLinks: [], taskRelations: [], truncated };
}

/** A runtime over a tiny in-memory "server" of task rows. */
function fakeServer(rows: Task[], opts: { fail?: () => boolean; delayList?: number } = {}) {
  const server = new Map(rows.map((t) => [t.id, { ...t }]));
  let clock = Date.parse("2026-10-08T11:00:00.000Z");
  // Whole-row writes must never come from the focus sink.
  const upsertTask = rs.fn((t: Task) => Promise.resolve({ ...t }));
  const writes = rs.fn((id: string, _ws: string, total: number) => {
    if (opts.fail?.()) return Promise.reject(new Error("offline"));
    const row = server.get(id);
    if (!row) return Promise.resolve(null);
    clock += 1000;
    const updatedAt = new Date(clock).toISOString();
    server.set(id, { ...row, timeSpentSeconds: total, updatedAt });
    return Promise.resolve({ timeSpentSeconds: total, updatedAt });
  });
  h.write = writes;
  const list = rs.fn((workspaceId: string) => {
    const bundle = bundleOf(
      [...server.values()].filter((t) => t.workspaceId === workspaceId).map((t) => ({ ...t })),
    );
    return opts.delayList
      ? new Promise<TasksModuleBundle>((r) => setTimeout(() => r(bundle), opts.delayList))
      : Promise.resolve(bundle);
  });
  const runtime = {
    tasks: {
      list,
      getTimeBlocks: rs.fn(() => Promise.resolve({})),
      listQueue: rs.fn(() => Promise.resolve([])),
      upsertTask,
      // A delete that hasn't reached the server yet.
      deleteTask: rs.fn(() => new Promise(() => {})),
      opCatchUp: rs.fn(() => Promise.resolve([])),
    },
  } as unknown as ModuoRuntime;
  return { runtime, server, upsertTask, writes };
}

async function mounted(
  rows: Task[],
  opts: { fail?: () => boolean; permission?: "view" | "edit"; truncated?: boolean } = {},
) {
  const { runtime, server, upsertTask, writes } = fakeServer(rows, { fail: opts.fail });
  if (opts.truncated) {
    (runtime.tasks.list as unknown as ReturnType<typeof rs.fn>).mockImplementation(() =>
      Promise.resolve(bundleOf(rows, [{ scope: "tasks", shown: rows.length, total: 5000 }])),
    );
  }
  const hook = renderHook(() =>
    useTasksModule(runtime, {
      userId: USER,
      workspaceId: WS,
      modulePermission: opts.permission ?? "edit",
    }),
  );
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return { hook, runtime, server, upsertTask, writes };
}

const totalOf = (tasks: Task[], id: string) => tasks.find((t) => t.id === id)?.timeSpentSeconds;

/** This tab has had the clock since before the list loaded; the time is older than the load. */
const SETTLED = { ownedSince: 0, earnedAt: 0 };

beforeEach(() => {
  localStorage.clear();
});

describe("persistFocusTime — the focus engine's sink", () => {
  it("saves the seconds into the task's total and says so", async () => {
    const { hook, writes, server } = await mounted([task("t1", 100)]);
    await expect(hook.result.current.persistFocusTime("t1", 60, SETTLED)).resolves.toBe(true);
    expect(writes.mock.calls[0]?.[2]).toBe(160);
    expect(server.get("t1")?.timeSpentSeconds).toBe(160);
    await waitFor(() => expect(totalOf(hook.result.current.tasks, "t1")).toBe(160));
  });

  it("reports a failed save and puts the total back", async () => {
    const { hook } = await mounted([task("t1", 100)], { fail: () => true });
    await expect(hook.result.current.persistFocusTime("t1", 60, SETTLED)).resolves.toBe(false);
    await waitFor(() => expect(totalOf(hook.result.current.tasks, "t1")).toBe(100));
  });

  it("a second save before React re-renders builds on the first, not on the stale bundle", async () => {
    const { hook, writes } = await mounted([task("t1", 100)]);
    const persist = hook.result.current.persistFocusTime; // the same render's closure
    await persist("t1", 60, SETTLED);
    await persist("t1", 5, SETTLED);
    expect(writes.mock.calls.map((c) => c[2])).toEqual([160, 165]);
  });

  it("says 'not now' while the bundle is loading", () => {
    const { runtime } = fakeServer([task("t1")]);
    const hook = renderHook(() =>
      useTasksModule(runtime, { userId: USER, workspaceId: WS, modulePermission: "edit" }),
    );
    expect(hook.result.current.persistFocusTime("t1", 30, SETTLED)).toBe(false);
  });

  it("a task missing from a complete list loaded after the time was tracked is gone", async () => {
    const { hook } = await mounted([task("t1")]);
    expect(hook.result.current.persistFocusTime("deleted", 30, SETTLED)).toBe("gone");
  });

  it("keeps the time when the task may just not be in this list yet", async () => {
    const later = { ownedSince: 0, earnedAt: Date.now() + 60_000 }; // tracked after this list loaded
    const complete = await mounted([task("t1")]);
    expect(complete.hook.result.current.persistFocusTime("new-elsewhere", 30, later)).toBe(false);
    const capped = await mounted([task("t1")], { truncated: true });
    expect(capped.hook.result.current.persistFocusTime("elsewhere", 30, SETTLED)).toBe(false);
  });

  it("a time save writes only the time: a Done still in flight stays done", async () => {
    const { hook, server, upsertTask } = await mounted([task("t1", 100)]);
    // Done went to the server; this render's bundle still says "todo".
    server.set("t1", { ...(server.get("t1") as Task), status: "done", title: "Renamed" });
    await expect(hook.result.current.persistFocusTime("t1", 60, SETTLED)).resolves.toBe(true);
    expect(server.get("t1")).toMatchObject({
      status: "done",
      title: "Renamed",
      timeSpentSeconds: 160,
    });
    expect(upsertTask).not.toHaveBeenCalled();
  });

  it("reloads the list before the first save after this tab took the clock", async () => {
    const { hook, server, runtime } = await mounted([task("t1", 100)]);
    server.set("t1", { ...task("t1", 250), updatedAt: "2026-10-08T12:00:00.000Z" }); // saved elsewhere
    const tookClock = { ownedSince: Date.now() + 1, earnedAt: 0 };
    expect(hook.result.current.persistFocusTime("t1", 60, tookClock)).toBe(false);
    await waitFor(() => expect(totalOf(hook.result.current.tasks, "t1")).toBe(250));
    expect(runtime.tasks.list).toHaveBeenCalledTimes(2);
    await expect(hook.result.current.persistFocusTime("t1", 60, SETTLED)).resolves.toBe(true);
    expect(server.get("t1")?.timeSpentSeconds).toBe(310);
  });

  it("reloads once per takeover while loads keep failing, not on every drain", async () => {
    const { hook, runtime } = await mounted([task("t1", 100)]);
    const list = runtime.tasks.list as unknown as ReturnType<typeof rs.fn>;
    list.mockImplementation(() => Promise.reject(new Error("offline")));
    const tookClock = { ownedSince: Date.now() + 1, earnedAt: 0 };
    for (let i = 0; i < 5; i++) {
      expect(hook.result.current.persistFocusTime("t1", 60, tookClock)).toBe(false);
      await waitFor(() => expect(hook.result.current.loading).toBe(false));
    }
    expect(list).toHaveBeenCalledTimes(2); // the first load + one reload
  });

  it("a task deleted here but not yet on the server isn't gone (Undo can bring it back)", async () => {
    const { hook } = await mounted([task("t1", 100)]);
    await act(async () => {
      hook.result.current.deleteTask("t1");
    });
    expect(hook.result.current.tasks.some((t) => t.id === "t1")).toBe(false);
    expect(hook.result.current.persistFocusTime("t1", 60, SETTLED)).toBe(false);
  });

  it("without edit access the save fails visibly instead of waiting forever", async () => {
    const { hook, upsertTask } = await mounted([task("t1")], { permission: "view" });
    await expect(hook.result.current.persistFocusTime("t1", 30, SETTLED)).resolves.toBe(false);
    expect(upsertTask).not.toHaveBeenCalled();
  });
});

// The sink as tasks-plan-view wires it: registered per workspace while /tasks
// is mounted, drained again once the bundle has loaded.
function useWiredSink(runtime: ModuoRuntime, workspaceId: string) {
  const api = useTasksModule(runtime, { userId: USER, workspaceId, modulePermission: "edit" });
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  });
  useEffect(
    () =>
      registerFocusFlushSink(workspaceId, (taskId, seconds, context) =>
        apiRef.current.persistFocusTime(taskId, seconds, context),
      ),
    [workspaceId],
  );
  useEffect(() => {
    if (!api.loading) flushFocusSession();
  }, [api.loading]);
  return api;
}

describe("the focus sink across workspaces and tabs", () => {
  afterEach(() => {
    __resetFocusEngineForTest();
    rs.useRealTimers();
  });

  it("switching workspace with Tasks open keeps the other workspace's held time", async () => {
    // 10 minutes tracked on a ws-2 task, not saved yet.
    localStorage.setItem(
      KEY,
      JSON.stringify({
        ...blankRecord(Date.now()),
        credits: {
          "t-w2": {
            workspaceId: "ws-2",
            ms: 600_000,
            inFlightMs: 0,
            inFlightAt: null,
            failedAt: null,
            earnedAt: Date.now(),
          },
        },
      }),
    );
    __resetFocusEngineForTest({ alert: () => {} });
    attachFocusUser(USER);
    const { runtime, server } = fakeServer([task("t-w1", 0, "ws-1"), task("t-w2", 100, "ws-2")], {
      delayList: 20,
    });
    const hook = renderHook(({ ws }) => useWiredSink(runtime, ws), {
      initialProps: { ws: "ws-1" },
    });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    // The workspace switcher flips the id; nothing remounts.
    hook.rerender({ ws: "ws-2" });
    await waitFor(() => expect(server.get("t-w2")?.timeSpentSeconds).toBe(700));
    expect(parseRecord(localStorage.getItem(KEY))?.credits["t-w2"]).toBeUndefined();
    hook.unmount();
  });

  it("a tab that takes over the clock builds on the other tab's saves", async () => {
    rs.useFakeTimers();
    const { runtime: rtA, server } = fakeServer([task("t1", 0)]);
    const tabA = renderHook(() =>
      useTasksModule(rtA, { userId: USER, workspaceId: WS, modulePermission: "edit" }),
    );
    // Tab B loaded the same row, and won't see A's saves (no live updates yet).
    const rtB = {
      tasks: { ...rtA.tasks, list: rs.fn(() => Promise.resolve(bundleOf([task("t1", 0)]))) },
    } as unknown as ModuoRuntime;
    const tabB = renderHook(() =>
      useTasksModule(rtB, { userId: USER, workspaceId: WS, modulePermission: "edit" }),
    );
    await act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
    const open = (tabId: string) => {
      const engine = createFocusEngine({
        storage: () => storage,
        now: () => Date.now(),
        readPrefs: () => ({ ...DEFAULT_FOCUS_PREFS, soundEnabled: false }) as FocusPrefs,
        alert: () => {},
        singleWindow: () => false,
        tabId,
      });
      engine.attach(USER);
      return engine;
    };
    const a = open("a");
    const b = open("b");
    a.registerSink(WS, (id, s, ctx) => tabA.result.current.persistFocusTime(id, s, ctx));
    b.registerSink(WS, (id, s, ctx) => tabB.result.current.persistFocusTime(id, s, ctx));
    a.bind({ id: "t1", title: "t1", bucketName: "Inbox", workspaceId: WS });
    a.start();
    b.storageChanged(KEY);
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await rs.advanceTimersByTimeAsync(60_000);
      });
    }
    await act(async () => {
      await rs.advanceTimersByTimeAsync(30_000);
    });
    expect(server.get("t1")?.timeSpentSeconds).toBe(180); // tab A's saves
    // Tab A closes; tab B picks the clock up by itself and saves with its old bundle.
    a.release();
    a.dispose();
    await act(async () => {
      await rs.advanceTimersByTimeAsync(61_000);
    });
    b.toggleRunning();
    await act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    expect(server.get("t1")?.timeSpentSeconds).toBe(271);
    b.dispose();
    tabA.unmount();
    tabB.unmount();
  });
});
