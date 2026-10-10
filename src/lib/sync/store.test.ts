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
  setStoreOptionsForTests,
  stampMinus,
  WorkspaceStore,
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
  const offlineError = () => new TypeError("Failed to fetch");
  const isOpen = (t: Task) => t.statusCategory === "todo" || t.statusCategory === "in_progress";

  const syncRead = rs.fn(async (input: SyncReadInput): Promise<SyncReadResult<unknown>> => {
    if (offline) throw offlineError();
    reads.push(input);
    const all = (tables[input.table] ?? []) as ServerRow[];
    const stamps = (rows: ServerRow[]) =>
      rows.map((r) => r.updatedAt).filter((s): s is string => !!s);
    let rows: ServerRow[];
    if (input.since) {
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
    await tick();
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
    await tick();
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

describe("offline: captures and check-offs (default g)", () => {
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
    await tick();
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

      await attachSyncUser(null);
      expect(cache.records.size).toBe(0);
      // Nothing is written back after sign-out.
      store.persistNow();
      await tick();
      expect(cache.records.size).toBe(0);
      release();
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
    await tick();

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
