// HV-15 variant of benchmarks/escapes/587-status-ops-race: a reference card's reopen sends its status op straight to the server, past a check-off still on its way. Fails until the fix lands.
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/features/spine/references/complete-task.587.variant.test.ts

import { describe, expect, it, rs } from "@rstest/core";

rs.mock("../../tasks/realtime", () => ({ listenTasksLive: () => () => {} }));
rs.mock("sonner", () => ({ toast: Object.assign(() => 1, { error: () => 1 }) }));
rs.mock("@/lib/undo-toast", () => ({ UNDO_TOAST_MS: 8000, undoToast: () => 1 }));

import {
  at,
  fakeServer,
  makeStore,
  ME,
  settled,
  task,
  tick,
  WS,
} from "../../../lib/sync/store.fake.spec";
import type { Task } from "../../tasks/model";
import { completeReferencedTask } from "./complete-task";

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

const hunt = process.env.MODUO_HUNT ? describe : describe.skip;

hunt("HV-15 variant 587: a reference card's reopen overtakes its own check-off", () => {
  async function setup() {
    const server = fakeServer();
    server.tables.tasks = [task("a", { updatedAt: at(5) })];
    const { store } = makeStore(server);
    await settled(store);
    const run = (done: boolean) =>
      completeReferencedTask({
        runtime: server.runtime,
        workspaceId: WS,
        userId: ME,
        taskId: "a",
        done,
        findStore: () => store,
      });
    return { server, store, run };
  }

  it("a reopen made while the check-off is still on its way lands after it", async () => {
    const { server, store, run } = await setup();
    const held = holdNextStatus(server);

    const done = run(true);
    await tick();
    // Unticked again before the check-off answered.
    const reopen = run(false);
    await tick(5);
    held.let();
    await Promise.allSettled([done, reopen]);
    await settled(store);

    // The person's last word was "not done".
    expect(server.statusCalls.map((c) => c.status)).toEqual(["done", "todo"]);
    expect((server.tables.tasks as Task[]).find((t) => t.id === "a")?.statusCategory).toBe("todo");
  });

  it("a reopen after the check-off failed on the network and waits on the device lands after it", async () => {
    const { server, store, run } = await setup();
    const held = holdNextStatus(server);

    const done = run(true);
    await tick();
    held.fail();
    await done;
    expect(store.waitingEntries()).toHaveLength(1);

    // Unticked; the connection is back before the outbox flushes.
    await run(false).catch(() => {});
    await store.syncNow();
    await store.flush();
    await settled(store);

    expect((server.tables.tasks as Task[]).find((t) => t.id === "a")?.statusCategory).toBe("todo");
  });
});
