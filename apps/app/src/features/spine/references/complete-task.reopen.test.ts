// Regression test for the HV-15 variants of benchmarks/escapes/561, 587 and
// 645-1 (found three times): a reference card's Reopen called opSetStatus
// directly, past the store's `statusMustWait` / `sendingStatus`, so it went
// live ahead of the card's own check-off still on its way and the task ended
// Done. Fixed in `complete-task.ts`: Reopen is the store's status write too,
// waiting on the device behind any older one for the task.

import { describe, expect, it, rs } from "@rstest/core";

rs.mock("../../tasks/realtime", () => ({ listenTasksLive: () => () => {} }));
rs.mock("@/lib/undo-toast", () => ({ UNDO_TOAST_MS: 8000, undoToast: () => 1 }));
rs.mock("sonner", () => ({ toast: Object.assign(() => 1, { error: () => 1 }) }));

import {
  at,
  fakeServer,
  makeStore,
  settled,
  task,
  tick,
  WS,
} from "../../../lib/sync/store.fake.spec";
import type { Task } from "../../tasks/model";
import { completeReferencedTask } from "./complete-task";

/** Hold the next status op's request until `let`. */
function holdNextStatus(server: ReturnType<typeof fakeServer>) {
  const tasksApi = server.runtime.tasks as unknown as {
    opSetStatus: (input: { taskId: string; status: string }) => Promise<Task>;
  };
  const real = tasksApi.opSetStatus;
  let open: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  let held = true;
  tasksApi.opSetStatus = async (input) => {
    if (held) {
      held = false;
      await gate;
    }
    return real(input);
  };
  return { let: () => open() };
}

async function setup() {
  const server = fakeServer();
  server.tables.tasks = [task("a", { updatedAt: at(5) })];
  const { store } = makeStore(server);
  await settled(store);
  const held = holdNextStatus(server);
  const run = (done: boolean) =>
    completeReferencedTask({
      runtime: server.runtime,
      workspaceId: WS,
      userId: "me",
      taskId: "a",
      done,
      findStore: () => store,
    });
  const onServer = () => (server.tables.tasks as Task[]).find((t) => t.id === "a");
  const shown = () => store.getSnapshot().bundle.tasks.find((t) => t.id === "a");
  return { server, store, held, run, onServer, shown };
}

describe("a reference card's Reopen waits behind its own check-off", () => {
  it("ticking then unticking before the server answers leaves the task To do", async () => {
    const { server, store, held, run, onServer } = await setup();

    // Ticked on the card: the check-off is on its way, not answered yet.
    const ticking = run(true);
    await tick();
    // Unticked before the answer: the reopen must land after it.
    const unticking = run(false);
    await tick(5);
    held.let();
    await Promise.allSettled([ticking, unticking]);
    await store.flush();
    await settled(store);

    expect(server.statusCalls.map((c) => c.status)).toEqual(["done", "todo"]);
    expect(onServer()?.statusCategory).toBe("todo");
  });

  it("the Reopen shows at once and doesn't hang on the check-off's answer", async () => {
    const { server, store, held, run, onServer, shown } = await setup();

    const ticking = run(true);
    await tick();
    expect(shown()?.statusCategory).toBe("done");
    // Resolves while the check-off is still held (it waits on the device).
    await run(false);
    expect(shown()?.statusCategory).toBe("todo");
    // Nothing went live past the held check-off.
    expect(server.statusCalls).toEqual([]);
    held.let();
    await ticking;
    await settled(store);

    expect(server.statusCalls.map((c) => c.status)).toEqual(["done", "todo"]);
    expect(server.statusCalls.at(-1)?.status).toBe("todo");
    expect(onServer()?.statusCategory).toBe("todo");
    expect(shown()?.statusCategory).toBe("todo");
  });

  it("waits behind a check-off made elsewhere through the store (the Tasks page, Home)", async () => {
    const { server, store, held, run, onServer } = await setup();

    const elsewhere = store.sendStatus({
      taskId: "a",
      status: "done",
      fields: { status: "done", statusCategory: "done" },
    });
    await tick();
    await run(false);
    held.let();
    await elsewhere;
    await settled(store);

    expect(server.statusCalls.map((c) => c.status)).toEqual(["done", "todo"]);
    expect(onServer()?.statusCategory).toBe("todo");
  });
});
