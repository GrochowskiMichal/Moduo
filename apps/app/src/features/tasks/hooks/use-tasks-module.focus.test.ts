import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode, useEffect } from "react";

import { DEFAULT_FOCUS_PREFS, type FocusPrefs } from "../../../lib/focus-prefs";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { findWorkspaceStore } from "../../../lib/sync/store";
import {
  __resetFocusEngineForTest,
  attachFocusUser,
  createFocusEngine,
  flushFocusSession,
  FOCUS_STORAGE_PREFIX,
  type FocusSaveContext,
  registerFocusFlushSink,
} from "../../focus/engine";
import { blankRecord, parseRecord } from "../../focus/engine-core";
import { createFocusTimeSink } from "../../focus/time-sink";
import { makeTask } from "../helpers";
import type { Task, TasksModuleBundle, TaskTimeResult, TrackTimeInput } from "../model";
import { TasksProvider } from "../tasks-context";
import { renderTasksHook, useTasksProbe } from "../testing/tasks-hook";

// Live updates (TV-D5) need a socket; these tests drive the hook without one.
rs.mock("../realtime", () => ({ listenTasksLive: () => () => {} }));

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
      listQueue: rs.fn(() => Promise.resolve([])),
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
  const hook = renderTasksHook(fake.runtime, {
    userId: USER,
    workspaceId: WS,
    modulePermission: opts.permission ?? "edit",
  });
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

describe("time corrections (D3-3)", () => {
  it("typing a total sends the total, not a difference", async () => {
    const { hook, trackTime, server } = await mounted([task("t1", 100)]);
    act(() => hook.result.current.commands.setTimeSpent("t1", 1800));
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
    const { hook, trackTime, server, runtime } = await mounted([task("t1", 100)]);
    let adjustment: Awaited<ReturnType<typeof hook.result.current.commands.logTimeAdjustment>> =
      null;
    await act(async () => {
      adjustment = await hook.result.current.commands.logTimeAdjustment("t1", 900);
    });
    expect(adjustment).toEqual({ entryId: "e1", seconds: 900 });
    expect(server.get("t1")?.timeSpentSeconds).toBe(1000);
    // Someone's focus lands in between; the Undo takes only the adjustment back.
    await shellSink(runtime, WS)("t1", 60, ctx("k-1"));
    await act(async () => {
      hook.result.current.commands.undoTimeAdjustment("t1", adjustment as never);
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

describe("time writes in order", () => {
  it("one task's writes go one at a time, so the last total shown is the latest", async () => {
    const { hook, runtime, server } = await mounted([task("t1", 100)]);
    const real = runtime.tasks.trackTime;
    const gates: Array<() => void> = [];
    const sent: number[] = [];
    // The first answer is slow; a second write mustn't overtake it.
    (runtime.tasks as { trackTime: typeof real }).trackTime = (input) => {
      sent.push(input.seconds ?? 0);
      return new Promise((resolve) => {
        gates.push(() => resolve(real(input)));
      });
    };
    let first: Promise<unknown> = Promise.resolve();
    let second: Promise<unknown> = Promise.resolve();
    await act(async () => {
      first = hook.result.current.commands.logTimeAdjustment("t1", 300);
      second = hook.result.current.commands.logTimeAdjustment("t1", 300);
      await Promise.resolve();
    });
    expect(sent).toEqual([300]); // the second waits for the first
    await act(async () => {
      gates[0]?.();
      await first;
    });
    await waitFor(() => expect(sent).toEqual([300, 300]));
    await act(async () => {
      gates[1]?.();
      await second;
    });
    expect(server.get("t1")?.timeSpentSeconds).toBe(700);
    expect(totalOf(hook.result.current.tasks, "t1")).toBe(700);
  });
});

// The one sink (TV-F6), as the app shell builds it (use-focus-time-saver.ts):
// straight through the track-time op, each saved total into the store copy.
function shellSink(runtime: ModuoRuntime, workspaceId: string) {
  return createFocusTimeSink({
    workspaceId,
    canEdit: () => true,
    trackTime: (input) => runtime.tasks.trackTime(input),
    onGone: () => {},
    onSaved: (saved) =>
      findWorkspaceStore(runtime, saved.workspaceId)?.patchCopy("tasks", saved.taskId, {
        timeSpentSeconds: saved.totalSeconds,
      }),
  });
}

// The sink registered per selected workspace (the shell does it for the
// workspace switcher's choice), with Tasks open (its provider: `wiredTasks`).
function useWiredSink(runtime: ModuoRuntime, workspaceId: string) {
  const api = useTasksProbe();
  useEffect(
    () => registerFocusFlushSink(workspaceId, shellSink(runtime, workspaceId)),
    [runtime, workspaceId],
  );
  useEffect(() => {
    if (!api.loading) flushFocusSession();
  }, [api.loading]);
  return api;
}

/** Tasks open on the workspace `selected.ws` names (the switcher flips it). */
function wiredTasks(runtime: ModuoRuntime, selected: { ws: string }) {
  return function WiredTasks({ children }: { children: ReactNode }) {
    return createElement(TasksProvider, {
      runtime,
      userId: USER,
      workspaceId: selected.ws,
      modulePermission: "edit",
      children,
    });
  };
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
    const selected = { ws: "ws-1" };
    const hook = renderHook(({ ws }) => useWiredSink(runtime, ws), {
      initialProps: { ws: "ws-1" },
      wrapper: wiredTasks(runtime, selected),
    });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    // The workspace switcher flips the id; nothing remounts.
    selected.ws = "ws-2";
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
    const tab = renderTasksHook(runtime, {
      userId: USER,
      workspaceId: WS,
      modulePermission: "edit",
    });
    await settle();
    const engine = openTab(memoryStorage(), "a");
    engine.registerSink(WS, shellSink(runtime, WS));
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
    const tabA = renderTasksHook(rtA, { userId: USER, workspaceId: WS, modulePermission: "edit" });
    // Tab B loaded the same row, and won't see A's saves (no live updates yet).
    const rtB = {
      tasks: { ...rtA.tasks, list: rs.fn(() => Promise.resolve(bundleOf([task("t1", 0)]))) },
    } as unknown as ModuoRuntime;
    const tabB = renderTasksHook(rtB, { userId: USER, workspaceId: WS, modulePermission: "edit" });
    await settle();
    const storage = memoryStorage();
    const a = openTab(storage, "a");
    const b = openTab(storage, "b");
    a.registerSink(WS, shellSink(rtA, WS));
    b.registerSink(WS, shellSink(rtB, WS));
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
