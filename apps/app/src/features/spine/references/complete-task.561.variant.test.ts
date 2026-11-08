// HV-15 variant of benchmarks/escapes/561-bulk-status-overtakes: a reference
// card's reopen sends the plain status op straight to the server, outside the
// shared store, while the task's check-off is still on its way, so the older
// check-off lands last and the task ends up Done. Fails until the fix lands.
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/features/spine/references/complete-task.561.variant.test.ts

import { describe, expect, it, rs } from "@rstest/core";
import { act, waitFor } from "@testing-library/react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { findWorkspaceStore } from "../../../lib/sync/store";
import { makeTask } from "../../tasks/helpers";
import type { Bucket, Task, TasksModuleBundle } from "../../tasks/model";

const toastMock = rs.hoisted(() =>
  Object.assign(
    rs.fn(() => "t"),
    { dismiss: rs.fn(), error: rs.fn(), message: rs.fn() },
  ),
);
rs.mock("sonner", () => ({ toast: toastMock }));
rs.mock("@/lib/undo-toast", () => ({ UNDO_TOAST_MS: 8000, undoToast: () => 1 }));
rs.mock("../../tasks/realtime", () => ({ listenTasksLive: () => () => {} }));

import { renderTasksHook } from "../../tasks/testing/tasks-hook";
import { completeReferencedTask } from "./complete-task";

const hunt = process.env.MODUO_HUNT ? describe : describe.skip;

const bucket = (id: string, over: Partial<Bucket> = {}): Bucket => ({
  id,
  workspaceId: "w1",
  ownerId: "u1",
  name: id,
  isSystem: false,
  group: null,
  position: id,
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
  ...over,
});

const task = (id: string): Task => ({
  ...makeTask({ workspaceId: "w1", bucketId: "p1", title: id, position: id }),
  id,
  creatorId: "u1",
  assigneeId: "u1",
  statusCategory: "todo",
  updatedAt: "2026-10-20T08:00:00.000Z",
});

/** A server whose first status op (the card's check-off) is held until released. */
function fakeServer(tasks: Task[]) {
  const rows = new Map(tasks.map((t) => [t.id, t]));
  let clock = 0;
  const write = async (id: string, patch: Partial<Task>) => {
    await new Promise((r) => setTimeout(r, 2));
    clock += 1;
    const next = {
      ...(rows.get(id) as Task),
      ...patch,
      updatedAt: new Date(Date.parse("2026-10-20T09:00:00.000Z") + clock * 1000).toISOString(),
    };
    rows.set(id, next);
    return next;
  };
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let statusCalls = 0;
  const bundle = (): TasksModuleBundle => ({
    buckets: [bucket("inbox", { isSystem: true, name: "Inbox" }), bucket("p1")],
    tasks: [...rows.values()],
    tags: [],
    tagLinks: [],
    taskRelations: [],
    truncated: [],
  });
  const api = {
    list: rs.fn(async () => bundle()),
    getTimeBlocks: rs.fn(async () => ({})),
    listQueue: rs.fn(async () => []),
    opCatchUp: rs.fn(async () => []),
    listTrash: rs.fn(async () => ({ buckets: [], tasks: [] })),
    opQueueAdd: rs.fn(async () => []),
    opQueueReorder: rs.fn(async () => []),
    opSetStatus: rs.fn(async ({ taskId, status }: { taskId: string; status: string }) => {
      statusCalls += 1;
      if (statusCalls === 1) await gate;
      const done = status === "done";
      return write(taskId, {
        status: done ? "done" : "todo",
        statusCategory: done ? "done" : "todo",
      });
    }),
  };
  return { runtime: { tasks: api } as unknown as ModuoRuntime, rows, release };
}

hunt(
  "HV-15 variant 561: a reference card's reopen jumps the task's check-off still on its way",
  () => {
    it("ticking a card and unticking it before the tick answers leaves the task To do", async () => {
      const server = fakeServer([task("a")]);
      const hook = renderTasksHook(server.runtime, {
        userId: "u1",
        workspaceId: "w1",
        modulePermission: "edit",
      });
      await waitFor(() => expect(hook.result.current.loading).toBe(false));
      expect(findWorkspaceStore(server.runtime, "w1")).toBeTruthy();
      const card = (done: boolean) =>
        completeReferencedTask({
          runtime: server.runtime,
          workspaceId: "w1",
          userId: "u1",
          taskId: "a",
          done,
        });
      let tick: Promise<void> = Promise.resolve();
      let untick: Promise<void> = Promise.resolve();
      await act(async () => {
        // The person ticks the card in a note, then unticks it at once.
        tick = card(true);
        await new Promise((r) => setTimeout(r, 5));
        untick = card(false);
        await new Promise((r) => setTimeout(r, 20));
      });
      await act(async () => {
        server.release();
        await Promise.allSettled([tick, untick]);
        await new Promise((r) => setTimeout(r, 40));
      });
      // The last thing the person did was reopen it.
      expect(server.rows.get("a")?.statusCategory).toBe("todo");
      hook.unmount();
    });
  },
);
