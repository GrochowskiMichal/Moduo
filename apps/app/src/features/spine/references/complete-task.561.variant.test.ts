// HV-15 variant of benchmarks/escapes/561-bulk-status-overtakes: a reference
// card's untick (Reopen) calls opSetStatus directly, without the store's
// statusMustWait / sendingStatus, so a check-off of the same task still on its
// way lands last and the task stays Done. Fails until the fix lands.
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/features/spine/references/complete-task.561.variant.test.ts

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

const hunt = process.env.MODUO_HUNT ? describe : describe.skip;

hunt("HV-15 variant 561: a reference untick overtakes the check-off still on its way", () => {
  it("ticking a reference and unticking it before the server answers leaves the task To do", async () => {
    const server = fakeServer();
    server.tables.tasks = [task("a", { updatedAt: at(5) })];
    const { store } = makeStore(server);
    await settled(store);
    const held = holdNextStatus(server);
    const run = (done: boolean) =>
      completeReferencedTask({
        runtime: server.runtime,
        workspaceId: WS,
        userId: null,
        taskId: "a",
        done,
        findStore: () => store as never,
      });

    // Tick: the check-off goes live through the store and is held.
    const tickOff = run(true);
    await tick();
    // Untick before it answers.
    const reopen = run(false).catch(() => {});
    await tick(5);
    held.let();
    await tickOff;
    await reopen;
    await store.flush();
    await settled(store);

    expect(server.statusCalls.map((c) => c.status)).toEqual(["done", "todo"]);
    expect((server.tables.tasks as Task[]).find((t) => t.id === "a")?.statusCategory).toBe("todo");
  });
});
