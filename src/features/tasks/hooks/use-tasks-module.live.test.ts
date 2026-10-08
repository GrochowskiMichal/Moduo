import { describe, expect, it, rs } from "@rstest/core";
import { act, renderHook, waitFor } from "@testing-library/react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { makeTask } from "../helpers";
import { ECHO_GRACE_MS, type LiveChange } from "../live";
import type { Task, TaskQueueEntry, TasksModuleBundle } from "../model";
import type { TasksLiveEvent } from "../realtime";
import { useTasksModule } from "./use-tasks-module";

// TV-D5 through the real hook: a teammate's change shows up (D5-1), our own
// optimistic edit is never flicked back by its echo (D5-2), and coming back
// to the app refetches, throttled (D5-3). The socket is faked.

const h = rs.hoisted(() => ({
  listener: null as null | ((event: TasksLiveEvent) => void),
}));
rs.mock("../realtime", () => ({
  listenTasksLive: (_ws: string, _me: string, fn: (event: TasksLiveEvent) => void) => {
    h.listener = fn;
    return () => {
      h.listener = null;
    };
  },
}));
// The hook's focus write imports the Supabase client; nothing here uses it.
rs.mock("../focus-time-write", () => ({ writeTaskTimeTotal: () => Promise.resolve(null) }));

const WS = "ws-1";
const ME = "u-me";
const MATE = "u-mate";

function task(over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: WS, bucketId: "b1", title: "Draft", position: "000000mh34" }),
    id: "t1",
    updatedAt: "2026-10-08T10:00:00.000000+00:00",
    ...over,
  };
}

function bundleOf(tasks: Task[]): TasksModuleBundle {
  return { buckets: [], tasks, tags: [], tagLinks: [], taskRelations: [], truncated: [] };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function fakeRuntime(rows: Task[]) {
  const server = { tasks: rows.map((t) => ({ ...t })), queue: [] as TaskQueueEntry[] };
  const saves: ReturnType<typeof deferred<Task>>[] = [];
  const list = rs.fn(() => Promise.resolve(bundleOf(server.tasks.map((t) => ({ ...t })))));
  const runtime = {
    tasks: {
      list,
      getTimeBlocks: () => Promise.resolve({}),
      listQueue: () => Promise.resolve(server.queue.slice()),
      updateTask: () => {
        const d = deferred<Task>();
        saves.push(d);
        return d.promise;
      },
      opCatchUp: () => Promise.resolve([]),
    },
  } as unknown as ModuoRuntime;
  return { runtime, server, saves, list };
}

function emit(change: LiveChange) {
  if (!h.listener) throw new Error("not listening");
  h.listener({ type: "change", change });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mount(runtime: ModuoRuntime) {
  return renderHook(() =>
    useTasksModule(runtime, { userId: ME, workspaceId: WS, modulePermission: "edit" }),
  );
}

describe("useTasksModule live updates", () => {
  it("D5-1: a teammate's new task, edit and queue claim show up", async () => {
    const { runtime } = fakeRuntime([task()]);
    const { result } = mount(runtime);
    await waitFor(() => expect(result.current.tasks).toHaveLength(1));
    await sleep(ECHO_GRACE_MS + 50); // the initial read's hold

    act(() => {
      emit({
        table: "tasks",
        kind: "upsert",
        row: task({ id: "t2", title: "From Mike", updatedAt: "2026-10-08T10:01:00Z" }),
      });
      emit({
        table: "tasks",
        kind: "upsert",
        row: task({ title: "Draft v2", updatedAt: "2026-10-08T10:02:00Z" }),
      });
      emit({
        table: "task_queue",
        kind: "upsert",
        row: {
          id: "q1",
          workspaceId: WS,
          userId: MATE,
          taskId: "t1",
          position: "000000mh34",
          queuedAt: "2026-10-08T10:03:00Z",
          updatedAt: "2026-10-08T10:03:00Z",
        },
      });
    });
    expect(result.current.tasks.map((t) => t.title).sort()).toEqual(["Draft v2", "From Mike"]);
    expect(result.current.queue.map((e) => e.userId)).toEqual([MATE]);
  });

  it("D5-2: the echo of an earlier save never reverts the edit in flight", async () => {
    const { runtime, saves } = fakeRuntime([task()]);
    const { result } = mount(runtime);
    await waitFor(() => expect(result.current.tasks).toHaveLength(1));
    await sleep(ECHO_GRACE_MS + 50);

    act(() => result.current.patchTask("t1", { title: "Draft 3" }));
    expect(result.current.tasks[0]!.title).toBe("Draft 3");

    // The echo of an earlier save ("Draft 2") arrives while "Draft 3" is saving.
    act(() =>
      emit({
        table: "tasks",
        kind: "upsert",
        row: task({ title: "Draft 2", updatedAt: "2026-10-08T10:00:01.000001+00:00" }),
      }),
    );
    expect(result.current.tasks[0]!.title).toBe("Draft 3");

    await act(async () => {
      saves[0]!.resolve(task({ title: "Draft 3", updatedAt: "2026-10-08T10:00:01.000002+00:00" }));
      await sleep(ECHO_GRACE_MS + 50);
    });
    expect(result.current.tasks[0]!.title).toBe("Draft 3");

    // Its own echo, late, is not newer either.
    act(() =>
      emit({
        table: "tasks",
        kind: "upsert",
        row: task({ title: "Draft 3", updatedAt: "2026-10-08T10:00:01.000002+00:00" }),
      }),
    );
    expect(result.current.tasks[0]!.title).toBe("Draft 3");

    // A teammate's later change still lands.
    act(() =>
      emit({
        table: "tasks",
        kind: "upsert",
        row: task({ title: "Mike's title", updatedAt: "2026-10-08T10:05:00Z" }),
      }),
    );
    expect(result.current.tasks[0]!.title).toBe("Mike's title");
  });

  it("D5-2: a teammate's change made during my save lands once it settles", async () => {
    const { runtime, saves } = fakeRuntime([task()]);
    const { result } = mount(runtime);
    await waitFor(() => expect(result.current.tasks).toHaveLength(1));
    await sleep(ECHO_GRACE_MS + 50);

    act(() => result.current.patchTask("t1", { title: "Mine" }));
    act(() =>
      emit({
        table: "tasks",
        kind: "upsert",
        row: task({ title: "Mine", priority: "high", updatedAt: "2026-10-08T10:00:03Z" }),
      }),
    );
    await act(async () => {
      saves[0]!.resolve(task({ title: "Mine", updatedAt: "2026-10-08T10:00:02Z" }));
      await sleep(ECHO_GRACE_MS + 50);
    });
    expect(result.current.tasks[0]).toMatchObject({ title: "Mine", priority: "high" });
  });

  it("D5-3: coming back refetches, at most once per 5 s plus one trailing read", async () => {
    const { runtime, server, list } = fakeRuntime([task()]);
    const { result } = mount(runtime);
    await waitFor(() => expect(result.current.tasks).toHaveLength(1));
    await sleep(ECHO_GRACE_MS + 50);
    expect(list).toHaveBeenCalledTimes(1);

    server.tasks.push(task({ id: "t9", title: "Made offline" }));
    // The first load counts for the throttle: a reconnect inside its 5 s
    // window reads once the window ends (trailing), not straight away.
    act(() => {
      h.listener?.({ type: "resync", reason: "reconnect" });
    });
    await sleep(300);
    expect(list).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.tasks).toHaveLength(2), { timeout: 6_000 });
    expect(list).toHaveBeenCalledTimes(2);
    // A quiet refetch never flips the loading flag.
    expect(result.current.loading).toBe(false);

    act(() => {
      h.listener?.({ type: "resync", reason: "reconnect" });
      h.listener?.({ type: "resync", reason: "reconnect" });
    });
    await sleep(300);
    expect(list).toHaveBeenCalledTimes(2); // throttled: one trailing read is waiting
  }, 15_000);

  it("D5-3: one return to the window (focus + visibility) reads once", async () => {
    const { runtime, list } = fakeRuntime([task()]);
    const { result } = mount(runtime);
    await waitFor(() => expect(result.current.tasks).toHaveLength(1));
    await sleep(5_100); // past the first load's refetch throttle
    act(() => {
      h.listener?.({ type: "resync", reason: "return" });
    });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    await sleep(ECHO_GRACE_MS + 50);
    act(() => {
      h.listener?.({ type: "resync", reason: "return" });
    });
    await sleep(5_200);
    expect(list).toHaveBeenCalledTimes(2);
  }, 20_000);

  it("D5-3: a refetch that raced my save is redone, never applied", async () => {
    const { runtime, server, saves, list } = fakeRuntime([task()]);
    const slow = deferred<TasksModuleBundle>();
    const { result } = mount(runtime);
    await waitFor(() => expect(result.current.tasks).toHaveLength(1));
    await sleep(5_100); // past the first load's refetch throttle

    list.mockImplementationOnce(() => slow.promise);
    act(() => {
      h.listener?.({ type: "resync", reason: "reconnect" });
    });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    act(() => result.current.patchTask("t1", { title: "Typed meanwhile" }));
    // The snapshot predates the edit.
    await act(async () => {
      slow.resolve(bundleOf([task({ title: "Draft" })]));
      await sleep(10);
    });
    expect(result.current.tasks[0]!.title).toBe("Typed meanwhile");

    server.tasks[0] = task({ title: "Typed meanwhile", updatedAt: "2026-10-08T10:00:04Z" });
    await act(async () => {
      saves[0]!.resolve(server.tasks[0]!);
      await sleep(5_000 + ECHO_GRACE_MS + 200);
    });
    expect(list).toHaveBeenCalledTimes(3);
    expect(result.current.tasks[0]!.title).toBe("Typed meanwhile");
  }, 20_000);
});
