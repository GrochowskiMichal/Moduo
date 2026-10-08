// The run on the Tasks page (TV-F2): Done, Skip (= to the end) and Remove do
// what they say and never touch the reschedule count (F2-2); Do now swaps a
// task in; Now leaving by someone else's hand gets a quiet line.

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, renderHook } from "@testing-library/react";

import { __resetFocusEngineForTest, attachFocusUser, getFocusSession } from "../../focus/engine";
import {
  __flushRunSyncForTest,
  __resetQueueRunForTest,
  attachRunUser,
  getQueueRunState,
} from "../../focus/run";
import type { FocusRunRuntime } from "../../focus/run-model";
import { makeTask } from "../helpers";
import type { ActivityEntry, Task } from "../model";
import { leftRunNotice, useQueueRun } from "./use-queue-run";

const USER = "u1";
const WS = "w1";

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: WS, bucketId: "b1", title: `Task ${id}`, position: id }),
    id,
    ...over,
  };
}

const offline: FocusRunRuntime = {
  latestRun: async () => null,
  startRun: async () => null,
  saveRun: async () => null,
  endRun: async () => null,
  listClaims: async () => [],
  keepLineUp: async () => null,
};

type Api = Parameters<typeof useQueueRun>[0]["api"];

function makeApi(queued: Task[], over: Partial<Api> = {}): Api {
  return {
    loading: false,
    error: null,
    loadedWorkspaceId: WS,
    tasks: queued,
    queuedTasks: queued,
    markDone: rs.fn(),
    moveQueuedToEnd: rs.fn(),
    removeFromQueue: rs.fn(),
    reorderQueue: rs.fn(),
    loadActivity: rs.fn(async () => [] as ActivityEntry[]),
    currentUserId: USER,
    ...over,
  };
}

function setup(queued: Task[], over: Partial<Api> = {}) {
  let api = makeApi(queued, over);
  const hook = renderHook(
    ({ a }: { a: Api }) => useQueueRun({ api: a, workspaceId: WS, bucketNameById: () => "Inbox" }),
    { initialProps: { a: api } },
  );
  return {
    hook,
    get api() {
      return api;
    },
    /** The queue changed (a load, or an optimistic op settled). */
    update(next: Partial<Api>) {
      api = { ...api, ...next };
      hook.rerender({ a: api });
    },
  };
}

beforeEach(() => {
  rs.useFakeTimers();
  localStorage.clear();
  __resetFocusEngineForTest({ alert: () => {} });
  __resetQueueRunForTest();
  attachFocusUser(USER);
  attachRunUser(USER, { focus: offline }, { subscribe: null });
});

afterEach(() => {
  __resetQueueRunForTest();
  __resetFocusEngineForTest();
  rs.useRealTimers();
});

describe("starting a run (F2-1)", () => {
  it("starts on the first open task of my queue", () => {
    const t = setup([task("t1", { status: "done" }), task("t2"), task("t3")]);
    act(() => t.hook.result.current.start("pomodoro"));
    expect(t.hook.result.current.runHere).toBe(true);
    expect(t.hook.result.current.nowTask?.id).toBe("t2");
    expect(t.hook.result.current.upNext.map((x) => x.id)).toEqual(["t3"]);
    expect(getFocusSession()).toMatchObject({ taskId: "t2", running: true, pomodoro: true });
  });

  it("an empty queue can't start", () => {
    const t = setup([]);
    act(() => t.hook.result.current.start("pomodoro"));
    expect(getQueueRunState().run).toBeNull();
  });
});

describe("Done, Skip, Remove, Do now (F2-2)", () => {
  it("Done completes Now, counts it, and the next task becomes Now with the rhythm kept", () => {
    const t = setup([task("t1"), task("t2")]);
    act(() => t.hook.result.current.start("pomodoro"));
    act(() => rs.advanceTimersByTime(5 * 60_000));
    act(() => t.hook.result.current.done());
    expect(t.api.markDone).toHaveBeenCalledWith("t1");
    expect(getFocusSession()).toMatchObject({
      taskId: "t2",
      running: true,
      phase: "work",
      pomoLeft: 20 * 60,
    });
    expect(getQueueRunState().run?.doneTaskIds).toEqual(["t1"]);
    t.update({ queuedTasks: [task("t1", { status: "done" }), task("t2")] });
    expect(t.hook.result.current.nowTask?.id).toBe("t2");
    expect(t.hook.result.current.progress).toEqual({ done: 1, total: 2 });
    expect(getQueueRunState().notice).toBeNull();
  });

  it("Skip sends Now to the end of my queue, not a reschedule", () => {
    const t = setup([task("t1"), task("t2"), task("t3")]);
    act(() => t.hook.result.current.start("stopwatch"));
    act(() => t.hook.result.current.skip());
    expect(t.api.moveQueuedToEnd).toHaveBeenCalledWith("t1");
    expect(t.api.markDone).not.toHaveBeenCalled();
    expect(getFocusSession().taskId).toBe("t2");
    t.update({ queuedTasks: [task("t2"), task("t3"), task("t1")] });
    expect(t.hook.result.current.nowTask?.id).toBe("t2");
    expect(t.hook.result.current.upNext.map((x) => x.id)).toEqual(["t3", "t1"]);
  });

  it("Skip on the only task leaves it as Now", () => {
    const t = setup([task("t1")]);
    act(() => t.hook.result.current.start("stopwatch"));
    act(() => t.hook.result.current.skip());
    expect(t.api.moveQueuedToEnd).not.toHaveBeenCalled();
    expect(getFocusSession()).toMatchObject({ taskId: "t1", running: true });
  });

  it("Remove from queue on Now moves the run to the next task", () => {
    const t = setup([task("t1"), task("t2")]);
    act(() => t.hook.result.current.start("stopwatch"));
    act(() => t.hook.result.current.remove("t1"));
    expect(t.api.removeFromQueue).toHaveBeenCalledWith("t1");
    expect(getFocusSession().taskId).toBe("t2");
  });

  it("Remove on Up next leaves Now alone", () => {
    const t = setup([task("t1"), task("t2")]);
    act(() => t.hook.result.current.start("stopwatch"));
    act(() => t.hook.result.current.remove("t2"));
    expect(t.api.removeFromQueue).toHaveBeenCalledWith("t2");
    expect(getFocusSession().taskId).toBe("t1");
  });

  it("Do now puts the task first; the old Now goes to the top of Up next", () => {
    const t = setup([task("t1"), task("t2"), task("t3")]);
    act(() => t.hook.result.current.start("stopwatch"));
    act(() => t.hook.result.current.doNow("t3"));
    expect(t.api.reorderQueue).toHaveBeenCalledWith(["t3", "t1", "t2"]);
    expect(getFocusSession().taskId).toBe("t3");
    t.update({ queuedTasks: [task("t3"), task("t1"), task("t2")] });
    expect(t.hook.result.current.upNext.map((x) => x.id)).toEqual(["t1", "t2"]);
  });

  it("the last Done ends the run", async () => {
    const t = setup([task("t1")]);
    act(() => t.hook.result.current.start("stopwatch"));
    act(() => t.hook.result.current.done());
    expect(getQueueRunState().run).toBeNull();
    expect(getQueueRunState().ended?.doneTaskIds).toEqual(["t1"]);
    expect(getFocusSession().tracking).toBe(false);
    await __flushRunSyncForTest();
  });

  it("Pause and End run work from the hook", () => {
    const t = setup([task("t1"), task("t2")]);
    act(() => t.hook.result.current.start("pomodoro"));
    act(() => t.hook.result.current.togglePause());
    expect(getFocusSession().running).toBe(false);
    act(() => t.hook.result.current.end());
    expect(getQueueRunState().run).toBeNull();
  });
});

describe("switching workspaces", () => {
  it("coming back to the run's workspace before its list loads keeps the run", () => {
    const w1 = [task("t1"), task("t2")];
    const other = { ...task("x1"), workspaceId: "w2" };
    const hook = renderHook(
      ({ a, ws }: { a: Api; ws: string }) =>
        useQueueRun({ api: a, workspaceId: ws, bucketNameById: () => "Inbox" }),
      { initialProps: { a: makeApi(w1), ws: WS } },
    );
    act(() => hook.result.current.start("stopwatch"));
    expect(getQueueRunState().run).not.toBeNull();
    // To w2: the first render still holds w1's list, my queue there is empty.
    hook.rerender({ a: { ...makeApi([]), tasks: w1 }, ws: "w2" });
    hook.rerender({ a: { ...makeApi([other]), loadedWorkspaceId: "w2" }, ws: "w2" });
    // Back to w1: w2's list until the read lands.
    hook.rerender({ a: { ...makeApi([]), tasks: [other], loadedWorkspaceId: "w2" }, ws: WS });
    expect(getQueueRunState().run).not.toBeNull();
    expect(getFocusSession()).toMatchObject({ tracking: true, taskId: "t1" });
    // w1's list lands: the run is still on t1.
    hook.rerender({ a: makeApi(w1), ws: WS });
    expect(getQueueRunState().run?.nowTaskId).toBe("t1");
    expect(getQueueRunState().notice).toBeNull();
  });

  it("a queue that's really empty after a load ends the run", () => {
    const w1 = [task("t1")];
    const hook = renderHook(
      ({ a }: { a: Api }) =>
        useQueueRun({ api: a, workspaceId: WS, bucketNameById: () => "Inbox" }),
      { initialProps: { a: makeApi(w1) } },
    );
    act(() => hook.result.current.start("stopwatch"));
    hook.rerender({ a: makeApi([]) });
    expect(getQueueRunState().run).toBeNull();
  });
});

describe("Now leaves by someone else's hand", () => {
  it("names who completed it", async () => {
    const loadActivity = rs.fn(async () => [
      {
        id: "a1",
        workspaceId: WS,
        module: "tasks",
        entityType: "task",
        entityId: "t1",
        op: "tasks.set_status",
        actorType: "user",
        actorId: "u2",
        actorLabel: "Mike",
        payload: { from: "todo", to: "done" },
        createdAt: new Date().toISOString(),
      } as ActivityEntry,
    ]);
    const t = setup([task("t1"), task("t2")], { loadActivity });
    act(() => t.hook.result.current.start("stopwatch"));
    // Mike completed t1: it left my queue and is done.
    await act(async () => {
      t.update({ tasks: [task("t1", { status: "done" }), task("t2")], queuedTasks: [task("t2")] });
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(getFocusSession().taskId).toBe("t2");
    expect(getQueueRunState().notice).toBe("Mike completed “Task t1”.");
    expect(getQueueRunState().run?.doneTaskIds).toEqual([]);
  });

  it("completed by me somewhere else counts for the run, quietly", async () => {
    const loadActivity = rs.fn(async () => [
      {
        op: "tasks.set_status",
        actorId: USER,
        actorLabel: "Me",
        actorType: "user",
        payload: { to: "done" },
      } as unknown as ActivityEntry,
    ]);
    const t = setup([task("t1"), task("t2")], { loadActivity });
    act(() => t.hook.result.current.start("stopwatch"));
    await act(async () => {
      t.update({ tasks: [task("t1", { status: "done" }), task("t2")], queuedTasks: [task("t2")] });
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(getQueueRunState().notice).toBeNull();
    expect(getQueueRunState().run?.doneTaskIds).toEqual(["t1"]);
  });

  it("my own completion that hasn't reached the trail yet is asked again, and counts", async () => {
    let calls = 0;
    const loadActivity = rs.fn(async () => {
      calls += 1;
      return calls === 1
        ? []
        : ([
            {
              op: "tasks.set_status",
              actorId: USER,
              actorLabel: "Me",
              actorType: "user",
              payload: { to: "done" },
            },
          ] as unknown as ActivityEntry[]);
    });
    const t = setup([task("t1"), task("t2")], { loadActivity });
    act(() => t.hook.result.current.start("stopwatch"));
    await act(async () => {
      t.update({ tasks: [task("t1", { status: "done" }), task("t2")], queuedTasks: [task("t2")] });
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(getQueueRunState().run?.doneTaskIds).toEqual([]);
    await act(async () => {
      rs.advanceTimersByTime(2000);
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(loadActivity).toHaveBeenCalledTimes(2);
    expect(getQueueRunState().notice).toBeNull();
    expect(getQueueRunState().run?.doneTaskIds).toEqual(["t1"]);
  });

  it("deleted or no longer shared: the run moves on and says so", () => {
    const t = setup([task("t1"), task("t2")]);
    act(() => t.hook.result.current.start("stopwatch"));
    act(() => t.update({ tasks: [task("t2")], queuedTasks: [task("t2")] }));
    expect(getFocusSession().taskId).toBe("t2");
    expect(getQueueRunState().notice).toBe(
      "“Task t1” was deleted or is no longer shared with you.",
    );
  });

  it("moved out of the queue elsewhere: no note", () => {
    const t = setup([task("t1"), task("t2")]);
    act(() => t.hook.result.current.start("stopwatch"));
    act(() => t.update({ queuedTasks: [task("t2")] }));
    expect(getFocusSession().taskId).toBe("t2");
    expect(getQueueRunState().notice).toBeNull();
  });

  it("classifies why a task left", () => {
    expect(leftRunNotice(undefined)).toBe("gone");
    expect(leftRunNotice(task("a", { status: "done" }))).toBe("completed");
    expect(leftRunNotice(task("a"))).toBeNull();
  });
});
