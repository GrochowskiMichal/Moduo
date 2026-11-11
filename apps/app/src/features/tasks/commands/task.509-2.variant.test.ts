// HV-15 variant of benchmarks/escapes/509-2-outbox-overtaken: a Board drop
// into another column waits its turn behind an older check-off still on its
// way (MOD-561), but a reorder of the same card made meanwhile (a drop with a
// place and no status) goes straight to the server: it lands first, and the
// waiting drop's status op then writes its older place over it
// (`tasks__apply_status` sets `position = coalesce(p_position, position)`).
// Fails until the fix lands.
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/features/tasks/commands/task.509-2.variant.test.ts

import { describe, expect, rs } from "@rstest/core";
import { act, waitFor } from "@testing-library/react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { findWorkspaceStore } from "../../../lib/sync/store";
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

hunt("HV-15 variant 509-2-outbox-overtaken: a live reorder jumps a drop waiting its turn", () => {
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

    await act(async () => {
      server.release();
      await first;
      await second;
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(server.rows.get("a")?.statusCategory).toBe("in_progress");
    // In the order they were made: the newer place is the one that stays.
    expect({ position: server.rows.get("a")?.position, log: server.log }).toEqual({
      position: "z",
      log: server.log,
    });
  });
});
