// Regression test for the HV-15 variant of benchmarks/escapes/509-2-outbox-
// overtaken: a Board drop into another column waits its turn behind an older
// check-off still on its way (MOD-561), but a reorder of the same card made
// meanwhile (a drop with a place and no status) went straight to the server:
// it landed first, and the waiting drop's status op then wrote its older place
// over it (`tasks__apply_status` sets `position = coalesce(p_position,
// position)`). Fixed by `chainTaskOp` (commands/shared.ts): a task's drops are
// shown at once and sent one after another.
// Run: bun run --cwd apps/app test src/features/tasks/commands/task-reorder.509-2.test.ts

import { describe, expect, it, rs } from "@rstest/core";
import { act, waitFor } from "@testing-library/react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { findWorkspaceStore, type WorkspaceStore } from "../../../lib/sync/store";
import { makeTask } from "../helpers";
import type { Bucket, Task, TasksModuleBundle } from "../model";

const toastMock = rs.hoisted(() =>
  Object.assign(
    rs.fn(() => "t"),
    { dismiss: rs.fn(), error: rs.fn(), message: rs.fn() },
  ),
);
rs.mock("sonner", () => ({ toast: toastMock }));
rs.mock("../realtime", () => ({ listenTasksLive: () => () => {} }));

import { renderTasksHook } from "../testing/tasks-hook";

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
  ...makeTask({ workspaceId: "w1", bucketId: "p1", title: id, position: "a0" }),
  id,
  creatorId: "u1",
  assigneeId: "u1",
  updatedAt: "2026-10-20T08:00:00.000Z",
});

/**
 * A server whose first status op (the queued check-off being flushed) is held
 * until released. Its status op keeps the place it is given, as
 * `tasks__apply_status` does (`position = coalesce(p_position, position)`).
 */
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
  const log: string[] = [];
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
    updateTask: rs.fn(({ taskId, patch }: { taskId: string; patch: Partial<Task> }) => {
      log.push(`update ${JSON.stringify(patch)}`);
      return write(taskId, patch);
    }),
    opUpdateTask: rs.fn(async ({ taskId, patch }: { taskId: string; patch: Partial<Task> }) => {
      log.push(`opUpdate ${JSON.stringify(patch)}`);
      return [await write(taskId, patch)];
    }),
    opSetStatus: rs.fn(
      async ({
        taskId,
        status,
        position,
      }: {
        taskId: string;
        status: string;
        position?: string;
      }) => {
        statusCalls += 1;
        if (statusCalls === 1) await gate;
        log.push(`status ${status}${position ? ` @${position}` : ""}`);
        const category =
          status === "done" ? "done" : status === "in_progress" ? "in_progress" : "todo";
        return write(taskId, {
          status: category,
          statusCategory: category,
          ...(position !== undefined ? { position } : {}),
        } as Partial<Task>);
      },
    ),
  };
  return { runtime: { tasks: api } as unknown as ModuoRuntime, rows, release, log };
}

type Hook = ReturnType<typeof renderTasksHook>;

describe("509-2-outbox-overtaken: a reorder never jumps the card's drop waiting its turn", () => {
  it("a reorder made while the card's drop into In progress waits its turn keeps its new place", async () => {
    const server = fakeServer([task("a")]);
    const hook = renderTasksHook(server.runtime, {
      userId: "u1",
      workspaceId: "w1",
      modulePermission: "edit",
    });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    const store = findWorkspaceStore(server.runtime, "w1");
    if (!store) throw new Error("no store");

    // An older check-off made offline waits in the outbox; the flush is sending it now.
    await act(async () => {
      store.enqueue({
        kind: "status",
        id: "op-old",
        taskId: "a",
        status: "done",
        fields: { status: "done", statusCategory: "done" },
      });
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(store.hasOutboxEntries("a")).toBe(true);

    // The person drags the card into In progress at "m": it waits its turn.
    let first: Promise<boolean> | null = null;
    await act(async () => {
      first = hook.result.current.commands.dropTask(
        { taskId: "a", status: "in_progress", position: "m" },
        "Moved",
      );
      await new Promise((r) => setTimeout(r, 10));
    });
    // Then reorders it inside In progress, to "z" (no status change).
    let second: Promise<boolean> | null = null;
    await act(async () => {
      second = hook.result.current.commands.dropTask({ taskId: "a", position: "z" }, "Moved");
      await new Promise((r) => setTimeout(r, 20));
    });
    // Both show at once: the card sits in In progress at its new place,
    // while nothing of either drop has gone out ahead of the older check-off.
    const shown = () => store.getSnapshot().bundle.tasks.find((t) => t.id === "a");
    expect(shown()?.statusCategory).toBe("in_progress");
    expect(shown()?.position).toBe("z");
    expect(server.log).toEqual([]);

    let saved: boolean[] = [];
    await act(async () => {
      server.release();
      saved = [
        await (first as unknown as Promise<boolean>),
        await (second as unknown as Promise<boolean>),
      ];
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(saved).toEqual([true, true]);
    expect(server.rows.get("a")?.statusCategory).toBe("in_progress");
    // In the order they were made: the newer place is the one that stays.
    expect(server.log).toEqual(["status done", "status in_progress @m", 'update {"position":"z"}']);
    expect(server.rows.get("a")?.position).toBe("z");
    expect(shown()?.position).toBe("z");
  });

  // Every way a check-off reaches the store: the list's (an intent op that
  // queues), Home's or a reference card's (`sendStatus`), a selection's.
  const checkOffs: Array<[string, (h: Hook, store: WorkspaceStore) => unknown]> = [
    ["the list's check-off", (h) => h.result.current.commands.writeTask("a", { status: "done" })],
    [
      "a check-off from Home or a reference card",
      (_h, store) =>
        store.sendStatus({
          taskId: "a",
          status: "done",
          fields: { status: "done", statusCategory: "done" },
        }),
    ],
    [
      "a selection's Done",
      (h) =>
        h.result.current.commands.bulkWrite([{ taskId: "a", status: "done" }], {
          label: (n) => `${n} done`,
        }),
    ],
  ];

  it.each(checkOffs)(
    "%s made while the card's drop waits its turn lands after the drop",
    async (_name, checkOff) => {
      const server = fakeServer([task("a")]);
      const hook = renderTasksHook(server.runtime, {
        userId: "u1",
        workspaceId: "w1",
        modulePermission: "edit",
      });
      await waitFor(() => expect(hook.result.current.loading).toBe(false));
      const store = findWorkspaceStore(server.runtime, "w1");
      if (!store) throw new Error("no store");

      // An older check-off made offline is being flushed now.
      await act(async () => {
        store.enqueue({
          kind: "status",
          id: "op-old",
          taskId: "a",
          status: "done",
          fields: { status: "done", statusCategory: "done" },
        });
        await new Promise((r) => setTimeout(r, 5));
      });
      // The card is dragged into In progress (it waits its turn), then checked off.
      let drop: Promise<boolean> | null = null;
      await act(async () => {
        drop = hook.result.current.commands.dropTask(
          { taskId: "a", status: "in_progress", position: "m" },
          "Moved",
        );
        await new Promise((r) => setTimeout(r, 10));
      });
      await act(async () => {
        void checkOff(hook, store);
        await new Promise((r) => setTimeout(r, 10));
      });
      const shown = () => store.getSnapshot().bundle.tasks.find((t) => t.id === "a");
      expect(shown()?.statusCategory).toBe("done");

      await act(async () => {
        server.release();
        await drop;
        await new Promise((r) => setTimeout(r, 80));
      });

      // In the order they were made: the check-off is the last word.
      expect(server.log).toEqual(["status done", "status in_progress @m", "status done"]);
      expect(server.rows.get("a")?.statusCategory).toBe("done");
      expect(shown()?.statusCategory).toBe("done");
    },
  );
});
