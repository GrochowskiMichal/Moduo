// HV-15 variant of benchmarks/escapes/645-1-queue-bypass: a reference card's Reopen goes live past the card's own check-off still on its way. Fails until the fix lands.
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/features/spine/references/complete-task.645-1.variant.test.ts

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

const hunt = process.env.MODUO_HUNT ? describe : describe.skip;

hunt("HV-15 variant 645-1: a Reopen from a note's card overtakes the card's own check-off", () => {
  it("Complete then Reopen on a reference card leaves the task open on the server", async () => {
    const server = fakeServer();
    server.tables.tasks = [task("a", { updatedAt: at(5) })];
    const { store } = makeStore(server);
    await settled(store);

    // Hold the first status request (the check-off) on its way.
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

    const run = (done: boolean) =>
      completeReferencedTask({
        runtime: server.runtime as never,
        workspaceId: WS,
        userId: "me",
        taskId: "a",
        done,
        findStore: () => store as never,
      });

    // Complete from the card (through the store, sent live), then Reopen
    // before its answer arrives.
    const completing = run(true);
    await tick();
    await run(false);
    open();
    await completing;
    await settled(store);

    // The person's last word was Reopen: the server must end on todo.
    expect(server.statusCalls.map((c) => c.status)).toEqual(["done", "todo"]);
    expect(server.statusCalls.at(-1)?.status).toBe("todo");
  });
});
