// HV-15 variant of benchmarks/escapes/587-status-ops-race: a reference card's reopen sends its status live past a check-off still on its way. Fails until the fix lands.
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/features/spine/references/complete-task.587.variant.test.ts

import { describe, expect, it, rs } from "@rstest/core";

rs.mock("../../tasks/realtime", () => ({ listenTasksLive: () => () => {} }));
rs.mock("@/lib/undo-toast", () => ({ UNDO_TOAST_MS: 8000, undoToast: () => 1 }));
rs.mock("sonner", () => ({ toast: Object.assign(() => 1, { error: () => 1 }) }));

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

hunt("HV-15 variant 587: a reference card's reopen overtakes its own check-off", () => {
  it("Complete then reopen on a reference card, before the check-off answers, leaves the task open", async () => {
    const server = fakeServer();
    server.tables.tasks = [task("a", { updatedAt: at(5) })];
    const { store } = makeStore(server);
    await settled(store);
    const held = holdNextStatus(server);
    const common = {
      runtime: server.runtime,
      workspaceId: WS,
      userId: ME,
      taskId: "a",
      findStore: () => store,
    };

    // Complete on the card: the check-off goes live through the shared store and is held.
    const done = completeReferencedTask({ ...common, done: true });
    await tick();
    // Reopen on the card before that answer comes back.
    const reopen = completeReferencedTask({ ...common, done: false });
    await tick(5);

    held.let();
    await Promise.allSettled([done, reopen]);
    await settled(store);

    // The person's last word was "reopen": it must reach the server last.
    expect(server.statusCalls.map((c) => c.status)).toEqual(["done", "todo"]);
    expect((server.tables.tasks as Task[]).find((t) => t.id === "a")?.statusCategory).toBe("todo");
  });
});
