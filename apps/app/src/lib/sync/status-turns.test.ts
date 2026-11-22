// A drop waiting its turn (`sendStatusInTurn`) holds back what was queued for
// its task after it (`StatusTurns`), but never the flush itself: an older
// check-off that comes back into the outbox in front of the held one (a live
// write from the session before that failed, MOD-569) is sent, so the drop
// can go and the held one after it.

import { describe, expect, it, rs } from "@rstest/core";

import type { Task } from "../../features/tasks/model";

rs.mock("../../features/tasks/realtime", () => ({ listenTasksLive: () => () => {} }));
rs.mock("sonner", () => ({ toast: Object.assign(() => {}, { error: () => {} }) }));

import { memoryCache } from "./cache";
import { attachSyncUser, setStoreOptionsForTests, workspaceStore } from "./store";
import { at, fakeServer, ME, settled, task, tick, WS } from "./store.fake.spec";

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

describe("a drop waiting its turn never stalls the flush", () => {
  it("an older check-off handed back in front of the held one is sent, then the drop, then the held one", async () => {
    const cache = memoryCache();
    setStoreOptionsForTests({ cache, timing: { persistMs: 0, throttleMs: 0 } });
    try {
      const server = fakeServer();
      server.tables.tasks = [task("a", { updatedAt: at(5) })];
      const store = workspaceStore(server.runtime, ME, WS);
      const release = store.acquire();
      await settled(store);
      const held = holdNextStatus(server);
      // A check-off on its way when the session drops and comes back.
      const sent = store.sendStatus({
        taskId: "a",
        status: "done",
        fields: { status: "done", statusCategory: "done" },
      });
      await tick();
      await attachSyncUser(null);
      release();
      await attachSyncUser(ME);
      const back = workspaceStore(server.runtime, ME, WS);
      const releaseBack = back.acquire();
      await settled(back);
      // A drop into In progress waits its turn behind it…
      const tasksApi = server.runtime.tasks as unknown as {
        opSetStatus: (input: {
          workspaceId: string;
          taskId: string;
          status: string;
        }) => Promise<Task>;
      };
      const drop = back.sendStatusInTurn("a", () =>
        tasksApi.opSetStatus({ workspaceId: WS, taskId: "a", status: "in_progress" }),
      );
      await tick();
      // …and a check-off made after it queues behind the drop.
      expect(
        await back.sendStatus({
          taskId: "a",
          status: "todo",
          fields: { status: "todo", statusCategory: "todo" },
        }),
      ).toBe("queued");
      await tick();
      // The old one fails on the network: it comes back in front of the held one.
      held.fail();
      expect(await sent).toBe("queued");
      await drop;
      await settled(back);
      expect(server.statusCalls.map((c) => c.status)).toEqual(["done", "in_progress", "todo"]);
      expect(back.waitingEntries()).toEqual([]);
      releaseBack();
    } finally {
      setStoreOptionsForTests({});
    }
  });
});
