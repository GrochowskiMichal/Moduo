// The shared store (TV-D11a, AC12.2 + AC12.8): it opens from the device copy
// and then reads only what changed, a Realtime echo of your own pending write
// never flicks it back, a refused write rolls back that one field without a
// reload, and offline captures and check-offs are sent in order once, each
// under its own id.

import { beforeEach, describe, expect, it, rs } from "@rstest/core";

import type { LiveChange } from "../../features/tasks/live";
import type { Task, TaskQueueEntry } from "../../features/tasks/model";
import type { TasksLiveEvent } from "../../features/tasks/realtime";

// The socket is faked: the store gets the listener here.
const live = rs.hoisted(() => ({ listener: null as null | ((e: TasksLiveEvent) => void) }));
rs.mock("../../features/tasks/realtime", () => ({
  listenTasksLive: (_ws: string, _me: string, fn: (e: TasksLiveEvent) => void) => {
    live.listener = fn;
    return () => {
      live.listener = null;
    };
  },
}));
rs.mock("sonner", () => ({ toast: Object.assign(() => {}, { error: () => {} }) }));

import type { ModuoRuntime } from "../runtime.types";
import { cacheKey, memoryCache } from "./cache";
import {
  attachSyncUser,
  keepWorkspaceCopies,
  setStoreOptionsForTests,
  stampMinus,
  WorkspaceStore,
  wipeSyncCopies,
  workspaceStore,
} from "./store";
import type { SyncReadInput, SyncReadResult, SyncTableName } from "./types";

const WS = "ws-1";
const ME = "u-me";

const at = (minute: number) => `2026-10-11T10:${String(minute).padStart(2, "0")}:00.000000+00:00`;

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    workspaceId: WS,
    number: null,
    creatorId: ME,
    creatorUnknown: false,
    assigneeId: ME,
    bucketId: "inbox",
    parentId: null,
    title: id,
    description: "",
    dueDate: null,
    dueOn: null,
    dueTime: null,
    scheduledAt: null,
    durationMinutes: null,
    timeSpentSeconds: 0,
    recurrence: null,
    energyLevel: null,
    priority: null,
    status: "todo",
    statusId: null,
    statusCategory: "todo",
    completedAt: null,
    completedBy: null,
    committedFor: null,
    commitOrder: null,
    rescheduleCount: 0,
    position: id,
    createdAt: at(0),
    updatedAt: at(1),
    deletedAt: null,
    ...over,
  };
}

type ServerRow = { id: string; updatedAt?: string; deletedAt?: string | null };

/** A server that answers `syncRead` like PostgREST does, and records each read. */
function fakeServer() {
  const tables: Partial<Record<SyncTableName, ServerRow[]>> = { tasks: [] };
  const reads: SyncReadInput[] = [];
  const created: Task[] = [];
  const statusCalls: { taskId: string; status: string }[] = [];
  let offline = false;
  /** A read refused by the server (not the network), when set. */
  let refuse: string | null = null;
  const offlineError = () => new TypeError("Failed to fetch");
  const isOpen = (t: Task) => t.statusCategory === "todo" || t.statusCategory === "in_progress";

  const syncRead = rs.fn(async (input: SyncReadInput): Promise<SyncReadResult<unknown>> => {
    if (offline) throw offlineError();
    if (refuse) throw new Error(refuse);
    reads.push(input);
    const all = (tables[input.table] ?? []) as ServerRow[];
    const stamps = (rows: ServerRow[]) =>
      rows.map((r) => r.updatedAt).filter((s): s is string => !!s);
    let rows: ServerRow[];
    if (input.ids) {
      const wanted = new Set(input.ids);
      rows = all.filter((r) => wanted.has(r.id) && !r.deletedAt);
    } else if (input.since) {
      rows = all.filter((r) => (r.updatedAt ?? "") >= (input.since as string));
    } else {
      rows = all.filter((r) => !r.deletedAt);
      if (input.table === "tasks" && input.part) {
        rows = rows.filter((r) => isOpen(r as Task) === (input.part === "open"));
      }
    }
    const maxUpdatedAt = stamps(rows).sort().pop() ?? null;
    return {
      rows: rows.filter((r) => !r.deletedAt),
      deleted: rows.filter((r) => r.deletedAt).map((r) => r.id),
      maxUpdatedAt,
      truncated: null,
    };
  });

  const runtime = {
    tasks: {
      syncRead,
      list: rs.fn(),
      listQueue: rs.fn(),
      syncIds: rs.fn(async ({ table }: { table: SyncTableName }) => ({
        ids: ((tables[table] ?? []) as ServerRow[]).filter((r) => !r.deletedAt).map((r) => r.id),
        complete: true,
      })),
      createTask: rs.fn(async (t: Task) => {
        if (offline) throw offlineError();
        const existing = (tables.tasks as Task[]).find((x) => x.id === t.id);
        if (existing) return existing; // the op is idempotent on a resent id
        const saved = { ...t, updatedAt: at(30) };
        (tables.tasks as Task[]).push(saved);
        created.push(saved);
        return saved;
      }),
      upsertTask: rs.fn(),
      opSetStatus: rs.fn(async ({ taskId, status }: { taskId: string; status: string }) => {
        if (offline) throw offlineError();
        const rows = tables.tasks as Task[];
        const index = rows.findIndex((x) => x.id === taskId);
        if (index === -1) throw new Error("No such task.");
        statusCalls.push({ taskId, status });
        rows[index] = {
          ...rows[index]!,
          status: status === "done" ? "done" : "todo",
          statusCategory: status === "done" ? "done" : "todo",
          updatedAt: at(31 + statusCalls.length),
        };
        return rows[index]!;
      }),
      opQueueAdd: rs.fn(async (): Promise<TaskQueueEntry[]> => []),
      seedInbox: rs.fn(async (workspaceId: string) => {
        const inbox = {
          id: "inbox-mine",
          workspaceId,
          ownerId: ME,
          name: "Inbox",
          isSystem: true,
          group: null,
          position: "a0",
          createdAt: at(40),
          updatedAt: at(40),
          deletedAt: null,
        };
        tables.buckets = [...(tables.buckets ?? []), inbox];
        return inbox;
      }),
    },
  } as unknown as ModuoRuntime;

  return {
    runtime,
    tables,
    reads,
    created,
    statusCalls,
    syncRead,
    goOffline: () => {
      offline = true;
    },
    goOnline: () => {
      offline = false;
    },
    refuseReads: (message: string | null) => {
      refuse = message;
    },
  };
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function settled(store: WorkspaceStore) {
  await store.whenLoaded();
  for (let i = 0; i < 20; i += 1) await tick();
}

function makeStore(server: ReturnType<typeof fakeServer>, cache = memoryCache()) {
  const store = new WorkspaceStore(server.runtime, ME, WS, {
    cache,
    timing: { persistMs: 0, throttleMs: 0, retryMs: 60_000 },
  });
  const release = store.acquire();
  return { store, cache, release };
}

const titleOf = (store: WorkspaceStore, id: string) =>
  store.getSnapshot().bundle.tasks.find((t) => t.id === id)?.title;

const emit = (change: LiveChange) => live.listener?.({ type: "change", change });

beforeEach(() => {
  live.listener = null;
});

describe("stampMinus", () => {
  it("moves a server stamp back, keeping its microseconds", () => {
    expect(stampMinus("2026-10-11T10:05:00.123456+00:00", 5 * 60_000)).toBe(
      "2026-10-11T10:00:00.123456+00:00",
    );
  });
});

describe("delta sync (AC12.2)", () => {
  it("a first load reads open tasks, shows them, then the rest", async () => {
    const server = fakeServer();
    server.tables.tasks = [task("open"), task("done", { status: "done", statusCategory: "done" })];
    const { store } = makeStore(server);
    await settled(store);
    const taskReads = server.reads.filter((r) => r.table === "tasks");
    expect(taskReads.map((r) => r.part)).toEqual(["open", "rest"]);
    expect(
      store
        .getSnapshot()
        .bundle.tasks.map((t) => t.id)
        .sort(),
    ).toEqual(["done", "open"]);
    expect(store.getSnapshot().restLoaded).toBe(true);
  });

  it("opens from the device copy, then fetches only rows changed since its cursor", async () => {
    const server = fakeServer();
    server.tables.tasks = [task("a"), task("b")];
    const first = makeStore(server);
    await settled(first.store);
    first.store.persistNow();
    await first.store.whenPersisted();
    first.release();
    first.store.dispose();
    expect(first.cache.records.has(cacheKey(ME, WS))).toBe(true);

    // Meanwhile on the server: b renamed, c added, a deleted.
    const rows = server.tables.tasks as Task[];
    rows[1] = { ...rows[1]!, title: "b renamed", updatedAt: at(10) };
    rows.push(task("c", { updatedAt: at(11) }));
    rows[0] = { ...rows[0]!, deletedAt: at(12), updatedAt: at(12) };
    server.reads.length = 0;

    let release = () => {};
    const store = new WorkspaceStore(server.runtime, ME, WS, {
      cache: first.cache,
      timing: { persistMs: 0, throttleMs: 0 },
    });
    // Before the server answers, the copy is on screen.
    const reading = new Promise<void>((resolve) => {
      const stop = store.subscribe(() => {
        if (store.getSnapshot().fromCache) {
          expect(titleOf(store, "b")).toBe("b");
          stop();
          resolve();
        }
      });
    });
    release = store.acquire();
    await reading;
    await settled(store);

    const taskRead = server.reads.find((r) => r.table === "tasks");
    // Only what changed since the cursor (a few minutes early, for late commits).
    expect(taskRead?.since).toBe(stampMinus(at(1), 5 * 60_000));
    expect(taskRead?.part).toBeUndefined();
    const snap = store.getSnapshot();
    expect(snap.fromCache).toBe(false);
    expect(snap.bundle.tasks.map((t) => t.id).sort()).toEqual(["b", "c"]);
    expect(titleOf(store, "b")).toBe("b renamed");
    release();
  });

  it("opening from the device copy, the first delta drops rows whose access was taken away", async () => {
    const server = fakeServer();
    server.tables.tasks = [task("a"), task("hidden")];
    const first = makeStore(server);
    await settled(first.store);
    first.store.persistNow();
    await first.store.whenPersisted();
    first.release();
    first.store.dispose();
    // Meanwhile the project went private: the row is gone from every read,
    // never "deleted", so no delta reports it.
    server.tables.tasks = [task("a")];
    const store = new WorkspaceStore(server.runtime, ME, WS, {
      cache: first.cache,
      timing: { persistMs: 0, throttleMs: 0 },
    });
    const release = store.acquire();
    await settled(store);
    expect(store.getSnapshot().bundle.tasks.map((t) => t.id)).toEqual(["a"]);
    release();
  });

  it("a live change lands only when the server stamped it later", async () => {
    const server = fakeServer();
    server.tables.tasks = [task("a", { updatedAt: at(5) })];
    const { store } = makeStore(server);
    await settled(store);
    emit({ table: "tasks", kind: "upsert", row: task("a", { title: "older", updatedAt: at(4) }) });
    expect(titleOf(store, "a")).toBe("a");
    emit({ table: "tasks", kind: "upsert", row: task("a", { title: "newer", updatedAt: at(6) }) });
    expect(titleOf(store, "a")).toBe("newer");
  });
});

describe("echo skip (AC12.2)", () => {
  it("your own pending write is skipped on echo; a teammate's other field lands", async () => {
    const server = fakeServer();
    server.tables.tasks = [task("a", { updatedAt: at(5) })];
    const { store } = makeStore(server);
    await settled(store);

    const write = store.begin([{ table: "tasks", patch: { id: "a", fields: { title: "Mine" } } }]);
    // The echo of an earlier save, then a teammate's priority, both newer.
    emit({ table: "tasks", kind: "upsert", row: task("a", { title: "a", updatedAt: at(6) }) });
    emit({
      table: "tasks",
      kind: "upsert",
      row: task("a", { title: "a", priority: "high", updatedAt: at(7) }),
    });
    const shown = store.getSnapshot().bundle.tasks.find((t) => t.id === "a");
    expect(shown?.title).toBe("Mine");
    expect(shown?.priority).toBe("high");

    // The answer is the row now; its own late echo changes nothing.
    write.settle({ tasks: [task("a", { title: "Mine", priority: "high", updatedAt: at(8) })] });
    emit({ table: "tasks", kind: "upsert", row: task("a", { title: "Mine", updatedAt: at(8) }) });
    expect(titleOf(store, "a")).toBe("Mine");
    expect(store.getSnapshot().bundle.tasks.find((t) => t.id === "a")?.priority).toBe("high");
  });
});

describe("one-field rollback (AC12.8)", () => {
  it("a server refusal rolls back that one field; nothing reloads", async () => {
    const server = fakeServer();
    server.tables.tasks = [task("a", { title: "Before", updatedAt: at(5) })];
    const { store } = makeStore(server);
    await settled(store);
    const readsBefore = server.syncRead.mock.calls.length;

    const title = store.begin([{ table: "tasks", patch: { id: "a", fields: { title: "Typed" } } }]);
    const priority = store.begin([
      { table: "tasks", patch: { id: "a", fields: { priority: "high" } } },
    ]);
    title.fail();
    const shown = store.getSnapshot().bundle.tasks.find((t) => t.id === "a");
    expect(shown?.title).toBe("Before");
    expect(shown?.priority).toBe("high");
    priority.settle({
      tasks: [task("a", { title: "Before", priority: "high", updatedAt: at(6) })],
    });
    await tick();
    expect(server.syncRead.mock.calls.length).toBe(readsBefore);
  });

  it("a teammate's newer write to the same field wins once yours fails", async () => {
    const server = fakeServer();
    server.tables.tasks = [task("a", { title: "Before", updatedAt: at(5) })];
    const { store } = makeStore(server);
    await settled(store);
    const write = store.begin([{ table: "tasks", patch: { id: "a", fields: { title: "Mine" } } }]);
    emit({ table: "tasks", kind: "upsert", row: task("a", { title: "Theirs", updatedAt: at(9) }) });
    expect(titleOf(store, "a")).toBe("Mine");
    write.fail();
    expect(titleOf(store, "a")).toBe("Theirs");
  });
});

describe("a delete stays deleted", () => {
  /** Hold the next read of `table`; `release(rows)` answers it with those rows. */
  function holdRead(server: ReturnType<typeof fakeServer>, table: SyncTableName) {
    const real = server.syncRead.getMockImplementation();
    let release: (rows: ServerRow[]) => void = () => {};
    let held = false;
    server.syncRead.mockImplementation(async (input: SyncReadInput) => {
      if (input.table !== table || held || !real) return real?.(input) as never;
      held = true;
      const rows = await new Promise<ServerRow[]>((resolve) => {
        release = resolve;
      });
      return {
        rows,
        deleted: [],
        maxUpdatedAt:
          rows
            .map((r) => r.updatedAt ?? "")
            .sort()
            .pop() ?? null,
        truncated: null,
      };
    });
    return (rows: ServerRow[]) => release(rows);
  }

  it("a read that started before a delete answer doesn't bring the row back", async () => {
    const server = fakeServer();
    server.tables.tasks = [task("a", { updatedAt: at(5) }), task("b", { updatedAt: at(5) })];
    const { store } = makeStore(server);
    await settled(store);
    const release = holdRead(server, "tasks");
    const reading = store.syncNow();
    await tick();
    const write = store.begin([{ table: "tasks", remove: "a" }]);
    write.settle({ tasks: [task("a", { deletedAt: at(20), updatedAt: at(20) })] });
    release([task("a", { updatedAt: at(5) }), task("b", { updatedAt: at(5) })]);
    await reading;
    await settled(store);
    expect(store.getSnapshot().bundle.tasks.map((t) => t.id)).toEqual(["b"]);
  });

  it("nor before a teammate's delete arriving live", async () => {
    const server = fakeServer();
    server.tables.tasks = [task("a", { updatedAt: at(5) })];
    const { store } = makeStore(server);
    await settled(store);
    const release = holdRead(server, "tasks");
    const reading = store.syncNow();
    await tick();
    emit({
      table: "tasks",
      kind: "upsert",
      row: task("a", { deletedAt: at(20), updatedAt: at(20) }),
    });
    release([task("a", { updatedAt: at(5) })]);
    await reading;
    await settled(store);
    expect(store.getSnapshot().bundle.tasks).toEqual([]);
    // A later restore (a newer stamp) still comes back.
    emit({ table: "tasks", kind: "upsert", row: task("a", { updatedAt: at(25) }) });
    expect(store.getSnapshot().bundle.tasks.map((t) => t.id)).toEqual(["a"]);
  });

  it("a task leaving my queue isn't put back by a read already on its way", async () => {
    const server = fakeServer();
    const entry: TaskQueueEntry = {
      id: "q1",
      workspaceId: WS,
      userId: ME,
      taskId: "a",
      position: "0000000001",
      queuedAt: at(1),
      updatedAt: at(1),
    };
    server.tables.tasks = [task("a")];
    server.tables.queue = [entry];
    const { store } = makeStore(server);
    await settled(store);
    expect(store.getSnapshot().queue.map((e) => e.id)).toEqual(["q1"]);
    const release = holdRead(server, "queue");
    const reading = store.syncNow();
    await tick();
    // A queue op answers: my queue is empty now.
    await store.queueOp(
      (mine) => mine.filter((e) => e.taskId !== "a"),
      async () => [],
    );
    release([entry]);
    await reading;
    await settled(store);
    expect(store.getSnapshot().queue).toEqual([]);
  });
});

describe("offline: captures and check-offs (default g)", () => {
  it("an older build's copy is read again, but what waited in it is still sent", async () => {
    const server = fakeServer();
    server.tables.tasks = [task("a", { updatedAt: at(5) })];
    const cache = memoryCache();
    cache.records.set(cacheKey(ME, WS), {
      v: 1,
      savedAt: 0,
      tables: { tasks: { rows: [task("stale-from-old-build")], cursor: at(1) } },
      restLoaded: true,
      outbox: [{ kind: "create", id: "op-old", task: task("waited", { title: "Waited" }) }],
    });
    const store = new WorkspaceStore(server.runtime, ME, WS, {
      cache,
      timing: { persistMs: 0, throttleMs: 0 },
    });
    const release = store.acquire();
    await settled(store);
    expect(server.created.map((t) => t.id)).toEqual(["waited"]);
    expect(
      store
        .getSnapshot()
        .bundle.tasks.map((t) => t.id)
        .sort(),
    ).toEqual(["a", "waited"]);
    release();
  });

  it("what waited on the device is sent after a reload, once", async () => {
    const server = fakeServer();
    server.tables.tasks = [task("a", { updatedAt: at(5) })];
    const first = makeStore(server);
    await settled(first.store);
    server.goOffline();
    first.store.wentOffline();
    first.store.enqueue({ kind: "create", id: "op-1", task: task("kept", { title: "Kept" }) });
    first.release();
    await first.store.whenPersisted();
    first.store.dispose();

    // Reopened (the app reloaded), the network back.
    server.goOnline();
    const store = new WorkspaceStore(server.runtime, ME, WS, {
      cache: first.cache,
      timing: { persistMs: 0, throttleMs: 0 },
    });
    const release = store.acquire();
    await settled(store);
    expect(store.getSnapshot().pending).toBe(0);
    expect(server.created.map((t) => t.id)).toEqual(["kept"]);
    expect(titleOf(store, "kept")).toBe("Kept");
    release();
  });

  it("queue on the device and flush in order on reconnect, without duplicates", async () => {
    const server = fakeServer();
    server.tables.tasks = [task("a", { updatedAt: at(5) })];
    const { store, cache } = makeStore(server);
    await settled(store);

    server.goOffline();
    store.wentOffline();
    expect(store.getSnapshot().offline).toBe(true);
    store.enqueue({ kind: "create", id: "op-1", task: task("new-1", { title: "Call the bank" }) });
    store.enqueue({
      kind: "status",
      id: "op-2",
      taskId: "a",
      status: "done",
      fields: { status: "done", statusCategory: "done" },
    });
    let snap = store.getSnapshot();
    expect(snap.pending).toBe(2);
    expect(titleOf(store, "new-1")).toBe("Call the bank");
    expect(snap.bundle.tasks.find((t) => t.id === "a")?.status).toBe("done");
    // Kept with the device copy, so a reload offline still has them.
    await store.whenPersisted();
    expect(cache.records.get(cacheKey(ME, WS))?.outbox).toHaveLength(2);

    // A flush attempt while still offline sends nothing.
    await store.flush();
    expect(server.created).toHaveLength(0);

    server.goOnline();
    await store.syncNow();
    await settled(store);
    snap = store.getSnapshot();
    expect(snap.offline).toBe(false);
    expect(snap.pending).toBe(0);
    expect(server.created.map((t) => t.id)).toEqual(["new-1"]);
    expect(server.statusCalls).toEqual([{ taskId: "a", status: "done" }]);
    expect((server.tables.tasks as Task[]).filter((t) => t.id === "new-1")).toHaveLength(1);
    expect(snap.bundle.tasks.find((t) => t.id === "a")?.status).toBe("done");

    // Sent again (an answer lost on the way): still one task.
    store.enqueue({ kind: "create", id: "op-3", task: task("new-1", { title: "Call the bank" }) });
    await settled(store);
    expect((server.tables.tasks as Task[]).filter((t) => t.id === "new-1")).toHaveLength(1);
  });

  it("a queued change the server refuses is dropped and shows the server's row", async () => {
    const server = fakeServer();
    server.tables.tasks = [task("a", { updatedAt: at(5) })];
    const { store } = makeStore(server);
    await settled(store);
    store.wentOffline();
    store.enqueue({
      kind: "status",
      id: "op-1",
      taskId: "gone",
      status: "done",
      fields: { status: "done" },
    });
    store.enqueue({
      kind: "status",
      id: "op-2",
      taskId: "a",
      status: "done",
      fields: { status: "done", statusCategory: "done" },
    });
    await store.syncNow();
    await settled(store);
    expect(store.getSnapshot().pending).toBe(0);
    expect(server.statusCalls.map((c) => c.taskId)).toEqual(["a"]);
  });
});

describe("the device copy is one person's", () => {
  async function persisted(store: WorkspaceStore) {
    await settled(store);
    store.persistNow();
    await store.whenPersisted();
  }

  it("sign-out wipes every copy and stops the stores", async () => {
    const cache = memoryCache();
    setStoreOptionsForTests({ cache, timing: { persistMs: 0, throttleMs: 0 } });
    try {
      const server = fakeServer();
      server.tables.tasks = [task("private-plan")];
      const store = workspaceStore(server.runtime, ME, WS);
      const release = store.acquire();
      await persisted(store);
      expect(cache.records.size).toBe(1);

      // What the SIGNED_OUT event and account deletion call.
      await wipeSyncCopies();
      expect(cache.records.size).toBe(0);
      // Nothing is written back after sign-out.
      store.persistNow();
      await store.whenPersisted();
      expect(cache.records.size).toBe(0);
      release();
    } finally {
      setStoreOptionsForTests({});
    }
  });

  it("a session that merely failed to load (an expired token offline) keeps the copy and what waits", async () => {
    const cache = memoryCache();
    setStoreOptionsForTests({ cache, timing: { persistMs: 0, throttleMs: 0 } });
    try {
      const server = fakeServer();
      server.tables.tasks = [task("a")];
      const store = workspaceStore(server.runtime, ME, WS);
      const release = store.acquire();
      await persisted(store);
      store.wentOffline();
      store.enqueue({ kind: "create", id: "op-1", task: task("on-the-plane") });
      release();

      await attachSyncUser(null);
      await store.whenPersisted();
      const copy = cache.records.get(cacheKey(ME, WS));
      expect(copy?.outbox).toHaveLength(1);
      expect(((copy?.tables.tasks?.rows ?? []) as Task[]).map((t) => t.id)).toEqual(["a"]);
    } finally {
      setStoreOptionsForTests({});
    }
  });

  it("copies of workspaces no longer on your list go", async () => {
    const cache = memoryCache();
    setStoreOptionsForTests({ cache, timing: { persistMs: 0, throttleMs: 0 } });
    try {
      const server = fakeServer();
      server.tables.tasks = [task("a")];
      for (const ws of ["ws-kept", "ws-left"]) {
        const store = workspaceStore(server.runtime, ME, ws);
        const release = store.acquire();
        await persisted(store);
        release();
      }
      await keepWorkspaceCopies(ME, ["ws-kept"]);
      expect([...cache.records.keys()]).toEqual([cacheKey(ME, "ws-kept")]);
    } finally {
      setStoreOptionsForTests({});
    }
  });

  it("another person never sees the first one's copy", async () => {
    const cache = memoryCache();
    setStoreOptionsForTests({ cache, timing: { persistMs: 0, throttleMs: 0 } });
    try {
      const server = fakeServer();
      server.tables.tasks = [task("a-secret", { title: "A's private task" })];
      const a = workspaceStore(server.runtime, "user-a", WS);
      const releaseA = a.acquire();
      await persisted(a);
      releaseA();
      expect(cache.records.has(cacheKey("user-a", WS))).toBe(true);

      // B signs in on the same device: A's copy goes; B's store starts empty.
      await attachSyncUser("user-b");
      expect([...cache.records.keys()].some((k) => k.startsWith("user-a:"))).toBe(false);
      server.tables.tasks = [];
      const b = workspaceStore(server.runtime, "user-b", WS);
      expect(b).not.toBe(a);
      const seen: string[] = [];
      const stop = b.subscribe(() => {
        for (const t of b.getSnapshot().bundle.tasks) seen.push(t.title);
      });
      const releaseB = b.acquire();
      await settled(b);
      stop();
      expect(seen).not.toContain("A's private task");
      expect(b.getSnapshot().bundle.tasks).toEqual([]);
      releaseB();
    } finally {
      setStoreOptionsForTests({});
    }
  });

  it("a project's tasks leave the device once access to it is taken away", async () => {
    const server = fakeServer();
    server.tables.tasks = [
      task("mine", { bucketId: "inbox" }),
      task("in-private-1", { bucketId: "p1" }),
      task("in-private-2", { bucketId: "p1" }),
    ];
    const cache = memoryCache();
    const store = new WorkspaceStore(server.runtime, ME, WS, {
      cache,
      timing: { persistMs: 0, throttleMs: 0, accessCheckMs: 0 },
    });
    const release = store.acquire();
    await settled(store);
    store.persistNow();
    await store.whenPersisted();

    // The project was made private: RLS hides its tasks. No delete reaches
    // the device, and a delta never returns them.
    server.tables.tasks = (server.tables.tasks as Task[]).filter((t) => t.bucketId !== "p1");
    await store.syncNow();
    await settled(store);

    expect(store.getSnapshot().bundle.tasks.map((t) => t.id)).toEqual(["mine"]);
    const copy = cache.records.get(cacheKey(ME, WS));
    const cachedIds = ((copy?.tables.tasks?.rows ?? []) as Task[]).map((t) => t.id);
    expect(cachedIds).toEqual(["mine"]);
    release();
  });
});

describe("what changes without a stamp (sharing, TV-D10)", () => {
  it("a task shared with you since arrives at the access check, read by id", async () => {
    const server = fakeServer();
    server.tables.tasks = [task("a", { updatedAt: at(5) })];
    const store = new WorkspaceStore(server.runtime, ME, WS, {
      cache: memoryCache(),
      timing: { persistMs: 0, throttleMs: 0, accessCheckMs: 0 },
    });
    const release = store.acquire();
    await settled(store);
    // A project was shared with you: its old task (an old stamp) is visible now.
    // (Its stamp is older than any delta's lookback.)
    (server.tables.tasks as Task[]).push(
      task("shared", { updatedAt: "2026-10-01T08:00:00.000000+00:00" }),
    );
    await store.syncNow();
    await settled(store);
    expect(
      store
        .getSnapshot()
        .bundle.tasks.map((t) => t.id)
        .sort(),
    ).toEqual(["a", "shared"]);
    expect(server.reads.some((r) => r.table === "tasks" && r.ids?.includes("shared"))).toBe(true);
    release();
  });

  it("a project shared with you brings its statuses at once (the access check runs when the projects change)", async () => {
    const server = fakeServer();
    const project = (id: string) => ({
      id,
      workspaceId: WS,
      ownerId: "u-mate",
      name: id,
      isSystem: false,
      group: null,
      position: id,
      createdAt: at(0),
      updatedAt: at(1),
      deletedAt: null,
    });
    server.tables.buckets = [project("mine")];
    const store = new WorkspaceStore(server.runtime, ME, WS, {
      cache: memoryCache(),
      // Not the periodic check: only the projects changing can run it.
      timing: { persistMs: 0, throttleMs: 0, accessCheckMs: 60 * 60_000 },
    });
    const release = store.acquire();
    await settled(store);
    // A first delta, so the store is past its first load.
    await store.syncNow();
    await settled(store);
    server.tables.buckets = [project("mine"), project("shared")];
    server.tables.statuses = [
      { id: "st-shared", projectId: "shared", updatedAt: "2026-10-01T08:00:00.000000+00:00" },
    ] as unknown as ServerRow[];
    await store.syncNow();
    await settled(store);
    expect(store.getSnapshot().bundle.statuses?.map((s) => s.id)).toEqual(["st-shared"]);
    release();
  });

  it("projects and areas are read whole each time, so one shown or hidden by sharing follows", async () => {
    const server = fakeServer();
    const area = (id: string) => ({ id, workspaceId: WS, name: id, updatedAt: at(1) });
    server.tables.areas = [area("work")];
    const { store } = makeStore(server);
    await settled(store);
    expect(store.getSnapshot().bundle.areas?.map((a) => a.id)).toEqual(["work"]);
    // A project in "home" was shared with you; "work"'s only project wasn't any more.
    server.tables.areas = [area("home")];
    await store.syncNow();
    await settled(store);
    expect(store.getSnapshot().bundle.areas?.map((a) => a.id)).toEqual(["home"]);
    const areaReads = server.reads.filter((r) => r.table === "areas");
    expect(areaReads.every((r) => r.since === null)).toBe(true);
  });
});

describe("staying honest about the copy", () => {
  it("a later read the server refuses says the copy isn't up to date, and keeps it", async () => {
    const server = fakeServer();
    server.tables.tasks = [task("a")];
    const { store } = makeStore(server);
    await settled(store);
    server.refuseReads("JWT expired");
    await store.syncNow();
    await settled(store);
    let snap = store.getSnapshot();
    expect(snap.error).toBeNull();
    expect(snap.syncError).toBe("JWT expired");
    expect(snap.bundle.tasks.map((t) => t.id)).toEqual(["a"]);
    server.refuseReads(null);
    await store.syncNow();
    await settled(store);
    snap = store.getSnapshot();
    expect(snap.syncError).toBeNull();
  });

  it("opening Tasks makes your Inbox when you have none", async () => {
    const server = fakeServer();
    const { store } = makeStore(server);
    await settled(store);
    const inbox = store.getSnapshot().bundle.buckets.find((b) => b.isSystem);
    expect(inbox?.ownerId).toBe(ME);
  });

  it("two tabs never drop each other's waiting captures", async () => {
    const server = fakeServer();
    server.tables.tasks = [task("a")];
    const cache = memoryCache();
    const timing = { persistMs: 0, throttleMs: 0, retryMs: 60_000 };
    const tabA = new WorkspaceStore(server.runtime, ME, WS, { cache, timing });
    const tabB = new WorkspaceStore(server.runtime, ME, WS, { cache, timing });
    const releaseA = tabA.acquire();
    const releaseB = tabB.acquire();
    await settled(tabA);
    await settled(tabB);
    server.goOffline();
    tabA.wentOffline();
    tabB.wentOffline();
    tabA.enqueue({ kind: "create", id: "from-a", task: task("captured-in-a") });
    await tabA.whenPersisted();
    // Tab B writes its copy after A: A's capture stays, and B takes it on.
    tabB.persistNow();
    await tabB.whenPersisted();
    const copy = cache.records.get(cacheKey(ME, WS));
    expect(((copy?.outbox ?? []) as { id: string }[]).map((e) => e.id)).toEqual(["from-a"]);
    expect(tabB.getSnapshot().pending).toBe(1);
    releaseA();
    releaseB();
  });

  it("every surface's queue ops share one chain: an earlier answer never clears a later line-up", async () => {
    const server = fakeServer();
    server.tables.tasks = [task("a"), task("b")];
    const { store } = makeStore(server);
    await settled(store);
    const entry = (taskId: string): TaskQueueEntry => ({
      id: `q-${taskId}`,
      workspaceId: WS,
      userId: ME,
      taskId,
      position: taskId,
      queuedAt: at(1),
      updatedAt: at(1),
    });
    let first: (rows: TaskQueueEntry[]) => void = () => {};
    const one = store.queueOp(
      (mine) => [...mine, entry("a")],
      () =>
        new Promise<TaskQueueEntry[]>((resolve) => {
          first = resolve;
        }),
    );
    // Another surface queues b meanwhile.
    const two = store.queueOp(
      (mine) => [...mine, entry("b")],
      async () => [entry("a"), entry("b")],
    );
    expect(store.getSnapshot().queue.map((e) => e.taskId)).toEqual(["a", "b"]);
    await tick();
    first([entry("a")]);
    await one;
    // The first answer (only a) doesn't hide b, still on its way.
    expect(store.getSnapshot().queue.map((e) => e.taskId)).toEqual(["a", "b"]);
    await two;
    expect(store.getSnapshot().queue.map((e) => e.taskId)).toEqual(["a", "b"]);
  });
});

describe("archived projects ride apart (TV-U6)", () => {
  const project = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    workspaceId: WS,
    ownerId: ME,
    name: id,
    isSystem: false,
    group: null,
    position: id,
    createdAt: at(0),
    updatedAt: at(1),
    deletedAt: null,
    ...over,
  });

  it("sets an archived project and its tasks apart, and keeps each list's identity while its rows do", async () => {
    const server = fakeServer();
    server.tables.buckets = [
      project("inbox-mine", { isSystem: true }),
      project("live"),
      project("old", { archivedAt: at(2) }),
    ];
    server.tables.tasks = [
      task("t-live", { bucketId: "live" }),
      task("t-old", { bucketId: "old" }),
    ];
    const { store } = makeStore(server);
    await settled(store);
    const first = store.getSnapshot().bundle;
    expect(first.buckets.map((b) => b.id)).toEqual(["inbox-mine", "live"]);
    expect(first.archivedBuckets?.map((b) => b.id)).toEqual(["old"]);
    expect(first.tasks.map((t) => t.id)).toEqual(["t-live"]);
    expect(first.archivedTasks?.map((t) => t.id)).toEqual(["t-old"]);

    // A task edit: both project lists, and the archived tasks, stay the same arrays.
    store.answer({
      tasks: [task("t-live", { bucketId: "live", title: "renamed", updatedAt: at(5) })],
    });
    const second = store.getSnapshot().bundle;
    expect(second.tasks[0]?.title).toBe("renamed");
    expect(second.buckets).toBe(first.buckets);
    expect(second.archivedBuckets).toBe(first.archivedBuckets);
    expect(second.archivedTasks).toBe(first.archivedTasks);

    // A project rename (the archived set unchanged): both task lists stay.
    store.answer({ buckets: [project("live", { name: "Live!", updatedAt: at(6) })] });
    const third = store.getSnapshot().bundle;
    expect(third.buckets.find((b) => b.id === "live")?.name).toBe("Live!");
    expect(third.tasks).toBe(second.tasks);
    expect(third.archivedTasks).toBe(second.archivedTasks);

    // An archive shown at once (an overlay): the project and its task move apart.
    const write = store.begin([
      { table: "buckets", patch: { id: "live", fields: { archivedAt: at(7) } } },
    ]);
    const fourth = store.getSnapshot().bundle;
    expect(fourth.buckets.map((b) => b.id)).toEqual(["inbox-mine"]);
    expect(fourth.tasks).toEqual([]);
    expect(fourth.archivedTasks?.map((t) => t.id).sort()).toEqual(["t-live", "t-old"]);
    write.fail();
    expect(store.getSnapshot().bundle.tasks.map((t) => t.id)).toEqual(["t-live"]);
  });
});
