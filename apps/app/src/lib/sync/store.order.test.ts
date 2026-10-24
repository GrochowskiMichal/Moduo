// Status writes land in the order they were made (MOD-587), a write still on
// its way when the session ends is kept for the person (MOD-569), and a copy
// that can't be read is never cut down as if nothing waited in it (HV-12).

import { describe, expect, it, rs } from "@rstest/core";

import type { Task } from "../../features/tasks/model";

rs.mock("../../features/tasks/realtime", () => ({ listenTasksLive: () => () => {} }));
rs.mock("sonner", () => ({ toast: Object.assign(() => {}, { error: () => {} }) }));

import { cacheKey, memoryCache } from "./cache";
import {
  attachSyncUser,
  setStoreOptionsForTests,
  wipeSyncCopies,
  type WorkspaceStore,
  workspaceStore,
} from "./store";
import { at, fakeServer, makeStore, ME, settled, task, tick, WS } from "./store.fake.spec";

describe("status writes in order (MOD-587, MOD-569)", () => {
  /** Hold the next status op's request until `let` (or `fail`, as a lost connection). */
  function holdNextStatus(server: ReturnType<typeof fakeServer>) {
    const tasksApi = server.runtime.tasks as unknown as {
      opSetStatus: (input: { taskId: string; status: string }) => Promise<Task>;
    };
    const real = tasksApi.opSetStatus;
    let open: (ok: boolean) => void = () => {};
    const gate = new Promise<boolean>((resolve) => {
      open = resolve;
    });
    let held = true;
    tasksApi.opSetStatus = async (input) => {
      if (held) {
        held = false;
        if (!(await gate)) throw new TypeError("Failed to fetch");
      }
      return real(input);
    };
    return { let: () => open(true), fail: () => open(false) };
  }

  it("MOD-587: a second check-off waits for a live one still on its way", async () => {
    const server = fakeServer();
    server.tables.tasks = [task("a", { updatedAt: at(5) })];
    const { store } = makeStore(server);
    await settled(store);
    const held = holdNextStatus(server);

    const first = store.sendStatus({
      taskId: "a",
      status: "done",
      fields: { status: "done", statusCategory: "done" },
    });
    await tick();
    // Changed again before the first answer: it waits, and shows at once.
    expect(
      await store.sendStatus({
        taskId: "a",
        status: "todo",
        fields: { status: "todo", statusCategory: "todo" },
      }),
    ).toBe("queued");
    expect(store.getSnapshot().bundle.tasks.find((t) => t.id === "a")?.statusCategory).toBe("todo");
    await tick(5);
    expect(server.statusCalls).toEqual([]);

    held.let();
    expect(await first).toBe("saved");
    await settled(store);
    expect(server.statusCalls.map((c) => c.status)).toEqual(["done", "todo"]);
    expect(store.getSnapshot().pending).toBe(0);
  });

  it("MOD-587: a live check-off that fails on the network goes back in front of the newer one", async () => {
    const server = fakeServer();
    server.tables.tasks = [task("a", { updatedAt: at(5) })];
    const { store } = makeStore(server);
    await settled(store);
    const held = holdNextStatus(server);

    const first = store.sendStatus({
      taskId: "a",
      status: "done",
      fields: { status: "done", statusCategory: "done" },
    });
    await tick();
    await store.sendStatus({
      taskId: "a",
      status: "todo",
      fields: { status: "todo", statusCategory: "todo" },
    });
    held.fail();
    expect(await first).toBe("queued");
    expect(store.waitingEntries().map((e) => (e.kind === "status" ? e.status : e.kind))).toEqual([
      "done",
      "todo",
    ]);
    // The newer one stays on show while both wait.
    expect(store.getSnapshot().bundle.tasks.find((t) => t.id === "a")?.statusCategory).toBe("todo");

    await store.syncNow();
    await store.flush();
    await settled(store);
    expect(server.statusCalls.map((c) => c.status)).toEqual(["done", "todo"]);
    expect((server.tables.tasks as Task[]).find((t) => t.id === "a")?.status).toBe("todo");
  });

  it("MOD-569: a check-off on its way at sign-out that then fails is kept for the person, and sent when they're back", async () => {
    const cache = memoryCache();
    setStoreOptionsForTests({ cache, timing: { persistMs: 0, throttleMs: 0 } });
    try {
      const server = fakeServer();
      server.tables.tasks = [task("a", { updatedAt: at(5) })];
      const store = workspaceStore(server.runtime, ME, WS);
      const release = store.acquire();
      await settled(store);
      const held = holdNextStatus(server);
      const sent = store.sendStatus({
        taskId: "a",
        status: "done",
        fields: { status: "done", statusCategory: "done" },
      });
      await tick();
      // Signed out before the answer; then the request fails on the network.
      await wipeSyncCopies();
      release();
      held.fail();
      expect(await sent).toBe("queued");
      await store.whenPersisted();
      const kept = cache.records.get(cacheKey(ME, WS))?.outbox as { taskId?: string }[];
      expect(kept.map((e) => e.taskId)).toEqual(["a"]);

      await attachSyncUser(ME);
      const back = workspaceStore(server.runtime, ME, WS);
      const releaseBack = back.acquire();
      await settled(back);
      await back.flush();
      await settled(back);
      expect(server.statusCalls.map((c) => c.status)).toEqual(["done"]);
      releaseBack();
    } finally {
      setStoreOptionsForTests({});
    }
  });

  it("MOD-569: one that fails after the person is back joins the new store in front of their newer check-off", async () => {
    const cache = memoryCache();
    setStoreOptionsForTests({ cache, timing: { persistMs: 0, throttleMs: 0 } });
    try {
      const server = fakeServer();
      server.tables.tasks = [task("a", { updatedAt: at(5) })];
      const store = workspaceStore(server.runtime, ME, WS);
      const release = store.acquire();
      await settled(store);
      const held = holdNextStatus(server);
      const sent = store.sendStatus({
        taskId: "a",
        status: "done",
        fields: { status: "done", statusCategory: "done" },
      });
      await tick();
      // The session drops (not a sign-out) and comes back at once.
      await attachSyncUser(null);
      release();
      await attachSyncUser(ME);
      const back = workspaceStore(server.runtime, ME, WS);
      const releaseBack = back.acquire();
      await settled(back);
      // The old one is still on its way: the new check-off waits behind it.
      expect(
        await back.sendStatus({
          taskId: "a",
          status: "todo",
          fields: { status: "todo", statusCategory: "todo" },
        }),
      ).toBe("queued");
      held.fail();
      expect(await sent).toBe("queued");
      expect(back.waitingEntries().map((e) => (e.kind === "status" ? e.status : e.kind))).toEqual([
        "done",
        "todo",
      ]);
      await back.syncNow();
      await back.flush();
      await settled(back);
      expect(server.statusCalls.map((c) => c.status)).toEqual(["done", "todo"]);
      releaseBack();
    } finally {
      setStoreOptionsForTests({});
    }
  });
});

describe("a copy that can't be read (HV-12)", () => {
  async function persisted(store: WorkspaceStore) {
    await settled(store);
    store.persistNow();
    await store.whenPersisted();
  }

  it("a copy that can't be read at sign-out stays whole, never read as 'nothing waits' (HV-12)", async () => {
    const cache = memoryCache();
    setStoreOptionsForTests({ cache, timing: { persistMs: 0, throttleMs: 0 } });
    try {
      const server = fakeServer();
      const store = workspaceStore(server.runtime, ME, WS);
      const release = store.acquire();
      await persisted(store);
      store.wentOffline();
      store.enqueue({ kind: "create", id: "op-1", task: task("on-the-plane") });
      await store.whenPersisted();
      // The disk goes away at the moment of sign-out.
      const update = cache.update;
      cache.update = async () => {
        throw new Error("The database connection is closing.");
      };
      await wipeSyncCopies();
      cache.update = update;
      expect(cache.records.get(cacheKey(ME, WS))?.outbox).toHaveLength(1);
      release();
    } finally {
      setStoreOptionsForTests({});
    }
  });
});
