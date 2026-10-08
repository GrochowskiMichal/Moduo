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
  type FocusSaveContext,
  flushFocusSession,
  registerFocusFlushSink,
} from "../../focus/engine";
import { blankRecord, parseRecord } from "../../focus/engine-core";
import { makeTask } from "../helpers";
import type { Task, TasksModuleBundle, TaskTimeResult, TrackTimeInput } from "../model";
import { useTasksModule } from "./use-tasks-module";

// Tracked time goes through tasks_op_track_time (TV-D3): the Focus engine's
// sink records stretches under the save's key, and every answer it gives
// decides whether tracked seconds are kept, retried or saved — never lost,
// never counted twice.

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

function bundleOf(tasks: Task[]): TasksModuleBundle {
  return { buckets: [], tasks, tags: [], tagLinks: [], taskRelations: [], truncated: [] };
}

/**
 * A runtime over a tiny in-memory "server": task rows, and the op's rules for
 * time (one entry per key and task, the total kept on the row).
 */
function fakeServer(
  rows: Task[],
  opts: { fail?: () => boolean; loseAnswer?: () => boolean; delayList?: number } = {},
) {
  const server = new Map(rows.map((t) => [t.id, { ...t }]));
  const keys = new Map<string, string>();
  let next = 0;
  const answer = (
    status: TaskTimeResult["status"],
    taskId: string,
    entryId: string | null,
    total: number | null,
  ): TaskTimeResult => ({
    status,
    taskId,
    entryId,
    totalSeconds: total,
    mySeconds: null,
    myWaitingSeconds: null,
  });
  const trackTime = rs.fn(async (input: TrackTimeInput): Promise<TaskTimeResult> => {
    if (opts.fail?.()) throw new Error("offline");
    const row = server.get(input.taskId);
    if (!row || row.workspaceId !== input.workspaceId) {
      return answer("gone", input.taskId, null, null);
    }
    const seen = input.key ? keys.get(`${input.taskId}:${input.key}`) : undefined;
    if (seen) return answer("duplicate", input.taskId, seen, row.timeSpentSeconds);
    const seconds = input.seconds ?? 0;
    const total =
      input.action === "set_total"
        ? seconds
        : input.action === "undo"
          ? row.timeSpentSeconds - seconds
          : input.action === "waiting"
            ? row.timeSpentSeconds
            : row.timeSpentSeconds + seconds;
    const entryId = `e${++next}`;
    if (input.key) keys.set(`${input.taskId}:${input.key}`, entryId);
    // Only the time changes on the row; never updated_at or anything else.
    server.set(input.taskId, { ...row, timeSpentSeconds: Math.max(0, total) });
    if (opts.loseAnswer?.()) throw new Error("connection lost after the write");
    return answer("saved", input.taskId, entryId, Math.max(0, total));
  });
  const list = rs.fn((workspaceId: string) => {
    const bundle = bundleOf(
      [...server.values()].filter((t) => t.workspaceId === workspaceId).map((t) => ({ ...t })),
    );
    return opts.delayList
      ? new Promise<TasksModuleBundle>((r) => setTimeout(() => r(bundle), opts.delayList))
      : Promise.resolve(bundle);
  });
  // Whole-row and field writes must never come from a time save.
  const upsertTask = rs.fn((t: Task) => Promise.resolve({ ...t }));
  const updateTask = rs.fn(() => Promise.reject(new Error("a time save wrote the row")));
  const runtime = {
    tasks: {
      list,
      getTimeBlocks: rs.fn(() => Promise.resolve({})),
      upsertTask,
      updateTask,
      trackTime,
      // A delete that hasn't reached the server yet.
      deleteTask: rs.fn(() => new Promise(() => {})),
      opCatchUp: rs.fn(() => Promise.resolve([])),
    },
  } as unknown as ModuoRuntime;
  return { runtime, server, trackTime, upsertTask, updateTask };
}

async function mounted(
  rows: Task[],
  opts: { fail?: () => boolean; permission?: "view" | "edit" } = {},
) {
  const fake = fakeServer(rows, { fail: opts.fail });
  const hook = renderHook(() =>
    useTasksModule(fake.runtime, {
      userId: USER,
      workspaceId: WS,
      modulePermission: opts.permission ?? "edit",
    }),
  );
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return { hook, ...fake };
}

const totalOf = (tasks: Task[], id: string) => tasks.find((t) => t.id === id)?.timeSpentSeconds;

const EARNED = Date.parse("2026-10-08T10:30:00.000Z");
function ctx(key: string, patch: Partial<FocusSaveContext> = {}): FocusSaveContext {
  return { ownedSince: 0, earnedAt: EARNED, workspaceId: WS, key, ...patch };
}

beforeEach(() => {
  localStorage.clear();
});

describe("persistFocusTime — the focus engine's sink", () => {
  it("records the seconds as a focus stretch under the save's key, ending when they were earned", async () => {
    const { hook, trackTime, server } = await mounted([task("t1", 100)]);
    await expect(hook.result.current.persistFocusTime("t1", 60, ctx("k-1"))).resolves.toBe(true);
    expect(trackTime).toHaveBeenCalledWith({
      workspaceId: WS,
      taskId: "t1",
      action: "focus",
      seconds: 60,
      endedAt: new Date(EARNED).toISOString(),
      key: "k-1",
    });
    expect(server.get("t1")?.timeSpentSeconds).toBe(160);
    await waitFor(() => expect(totalOf(hook.result.current.tasks, "t1")).toBe(160));
  });

  it("shows the server's total, which counts time teammates tracked meanwhile", async () => {
    const { hook, server } = await mounted([task("t1", 100)]);
    server.set("t1", { ...(server.get("t1") as Task), timeSpentSeconds: 400 }); // Mike's hour… almost
    await expect(hook.result.current.persistFocusTime("t1", 60, ctx("k-1"))).resolves.toBe(true);
    await waitFor(() => expect(totalOf(hook.result.current.tasks, "t1")).toBe(460));
  });

  it("a save sent again with its key counts once", async () => {
    const { hook, server } = await mounted([task("t1", 100)]);
    await hook.result.current.persistFocusTime("t1", 60, ctx("k-1"));
    await expect(hook.result.current.persistFocusTime("t1", 60, ctx("k-1"))).resolves.toBe(true);
    expect(server.get("t1")?.timeSpentSeconds).toBe(160);
    await waitFor(() => expect(totalOf(hook.result.current.tasks, "t1")).toBe(160));
  });

  it("reports a failed save and puts the shown total back", async () => {
    const { hook } = await mounted([task("t1", 100)], { fail: () => true });
    await expect(hook.result.current.persistFocusTime("t1", 60, ctx("k-1"))).resolves.toBe(false);
    await waitFor(() => expect(totalOf(hook.result.current.tasks, "t1")).toBe(100));
  });

  it("a task the server no longer has for you is gone", async () => {
    const { hook } = await mounted([task("t1")]);
    await expect(hook.result.current.persistFocusTime("deleted", 30, ctx("k-1"))).resolves.toBe(
      "gone",
    );
  });

  it("says 'not now' for another workspace's time or a task still being created", async () => {
    const { hook, trackTime } = await mounted([task("t1")]);
    expect(
      hook.result.current.persistFocusTime("t1", 30, ctx("k-1", { workspaceId: "ws-2" })),
    ).toBe(false);
    expect(hook.result.current.persistFocusTime("tmp-123", 30, ctx("k-2"))).toBe(false);
    expect(trackTime).not.toHaveBeenCalled();
  });

  it("saves while the list is still loading: the server keeps the total", async () => {
    const fake = fakeServer([task("t1", 100)], { delayList: 50 });
    const hook = renderHook(() =>
      useTasksModule(fake.runtime, { userId: USER, workspaceId: WS, modulePermission: "edit" }),
    );
    await expect(hook.result.current.persistFocusTime("t1", 30, ctx("k-1"))).resolves.toBe(true);
    expect(fake.server.get("t1")?.timeSpentSeconds).toBe(130);
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
  });

  it("a time save changes only the time: a Done or a rename in flight stays", async () => {
    const { hook, server, upsertTask, updateTask } = await mounted([task("t1", 100)]);
    // Done and a rename went to the server; this render's bundle still says "todo".
    server.set("t1", { ...(server.get("t1") as Task), status: "done", title: "Renamed" });
    await expect(hook.result.current.persistFocusTime("t1", 60, ctx("k-1"))).resolves.toBe(true);
    expect(server.get("t1")).toMatchObject({
      status: "done",
      title: "Renamed",
      timeSpentSeconds: 160,
    });
    expect(upsertTask).not.toHaveBeenCalled();
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("without edit access the save fails visibly instead of waiting forever", async () => {
    const { hook, trackTime } = await mounted([task("t1")], { permission: "view" });
    await expect(hook.result.current.persistFocusTime("t1", 30, ctx("k-1"))).resolves.toBe(false);
    expect(trackTime).not.toHaveBeenCalled();
  });
});

describe("time corrections (D3-3)", () => {
  it("typing a total sends the total, not a difference", async () => {
    const { hook, trackTime, server } = await mounted([task("t1", 100)]);
    act(() => hook.result.current.setTimeSpent("t1", 1800));
    await waitFor(() => expect(server.get("t1")?.timeSpentSeconds).toBe(1800));
    expect(trackTime).toHaveBeenCalledWith({
      workspaceId: WS,
      taskId: "t1",
      action: "set_total",
      seconds: 1800,
    });
    await waitFor(() => expect(totalOf(hook.result.current.tasks, "t1")).toBe(1800));
  });

  it("took longer adds one adjustment and its Undo removes exactly that one", async () => {
    const { hook, trackTime, server } = await mounted([task("t1", 100)]);
    let adjustment: Awaited<ReturnType<typeof hook.result.current.logTimeAdjustment>> = null;
    await act(async () => {
      adjustment = await hook.result.current.logTimeAdjustment("t1", 900);
    });
    expect(adjustment).toEqual({ entryId: "e1", seconds: 900 });
    expect(server.get("t1")?.timeSpentSeconds).toBe(1000);
    // Someone's focus lands in between; the Undo takes only the adjustment back.
    await hook.result.current.persistFocusTime("t1", 60, ctx("k-1"));
    await act(async () => {
      hook.result.current.undoTimeAdjustment("t1", adjustment as never);
    });
    await waitFor(() => expect(server.get("t1")?.timeSpentSeconds).toBe(160));
    expect(trackTime).toHaveBeenLastCalledWith({
      workspaceId: WS,
      taskId: "t1",
      action: "undo",
      entryId: "e1",
      seconds: 900,
    });
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

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

function openTab(storage: ReturnType<typeof memoryStorage>, tabId: string) {
  let n = 0;
  const engine = createFocusEngine({
    storage: () => storage,
    now: () => Date.now(),
    readPrefs: () => ({ ...DEFAULT_FOCUS_PREFS, soundEnabled: false }) as FocusPrefs,
    alert: () => {},
    singleWindow: () => false,
    tabId,
    newKey: () => `${tabId}-save-${++n}`,
  });
  engine.attach(USER);
  return engine;
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
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

  it("a save whose answer was lost is sent again with its key and counted once", async () => {
    rs.useFakeTimers();
    let lose = true;
    const { runtime, server, trackTime } = fakeServer([task("t1", 0)], {
      loseAnswer: () => lose,
    });
    const tab = renderHook(() =>
      useTasksModule(runtime, { userId: USER, workspaceId: WS, modulePermission: "edit" }),
    );
    await settle();
    const engine = openTab(memoryStorage(), "a");
    engine.registerSink(WS, (id, s, c) => tab.result.current.persistFocusTime(id, s, c));
    engine.bind({ id: "t1", title: "t1", bucketName: "Inbox", workspaceId: WS });
    engine.start();
    await act(async () => {
      await rs.advanceTimersByTimeAsync(30_000);
    });
    engine.toggleRunning(); // pause → the save reaches the server, its answer doesn't
    await settle();
    expect(server.get("t1")?.timeSpentSeconds).toBe(30);
    expect(engine.getSnapshot()).toMatchObject({ unsaved: true, accrued: 30 });
    lose = false;
    await act(async () => {
      await rs.advanceTimersByTimeAsync(15_000); // the retry
    });
    await settle();
    expect(trackTime.mock.calls.map(([input]) => [input.seconds, input.key])).toEqual([
      [30, "a-save-1"],
      [30, "a-save-1"],
    ]);
    expect(server.get("t1")?.timeSpentSeconds).toBe(30);
    expect(engine.getSnapshot()).toMatchObject({ unsaved: false, accrued: 0 });
    engine.dispose();
    tab.unmount();
  });

  it("a tab that takes over the clock adds to the other tab's saves", async () => {
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
    await settle();
    const storage = memoryStorage();
    const a = openTab(storage, "a");
    const b = openTab(storage, "b");
    a.registerSink(WS, (id, s, c) => tabA.result.current.persistFocusTime(id, s, c));
    b.registerSink(WS, (id, s, c) => tabB.result.current.persistFocusTime(id, s, c));
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
    // Tab A closes; tab B picks the clock up by itself and saves from its old list.
    a.release();
    a.dispose();
    await act(async () => {
      await rs.advanceTimersByTimeAsync(61_000);
    });
    b.toggleRunning();
    await settle();
    expect(server.get("t1")?.timeSpentSeconds).toBe(271);
    expect(totalOf(tabB.result.current.tasks, "t1")).toBe(271); // its old list shows the server's total
    b.dispose();
    tabA.unmount();
    tabB.unmount();
  });
});
