// TV-U14 · creating a capture through the shared store (TV-D11a): placed on
// top of its list, your Inbox found in the copy, offline captures waiting
// under their own ids with their links sent once they're out, the top of Up
// next, one Undo, and a refusal that stops the rest.

import { describe, expect, it, rs } from "@rstest/core";

import type { WorkspaceStore } from "../../../lib/sync/store";
import type { Bucket, Task } from "../model";
import { type CapturePlan, type CaptureTaskPlan, runCapture, undoCapture } from "./capture-create";

const WS = "w1";
const ME = "u-me";

const bucket = (id: string, over: Partial<Bucket> = {}): Bucket => ({
  id,
  workspaceId: WS,
  ownerId: ME,
  name: id,
  isSystem: false,
  group: null,
  position: "a",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
  ...over,
});

const item = (over: Partial<CaptureTaskPlan>): CaptureTaskPlan => ({
  id: crypto.randomUUID(),
  title: "Task",
  description: "",
  projectId: "",
  sectionId: null,
  teamId: null,
  assigneeId: undefined,
  parentId: null,
  position: "",
  dueDay: null,
  scheduledAt: null,
  recurrence: null,
  priority: null,
  estimateMinutes: null,
  tags: [],
  links: [],
  fromSource: false,
  remindAt: null,
  waitingOn: [],
  ...over,
});

/** A store as far as the capture uses it: a copy, creates, the line-up, Undo. */
function fakeStore(opts: { offline?: boolean; refuse?: string } = {}) {
  const listeners = new Set<() => void>();
  const outbox = new Set<string>();
  const sent: Array<{ task: Task; queue?: boolean }> = [];
  const shownRemoved: string[][] = [];
  const settled: Task[][] = [];
  const store = {
    whenLoaded: async () => {},
    isDisposed: () => false,
    getSnapshot: () => ({
      bundle: {
        buckets: [bucket("inbox-me", { isSystem: true }), bucket("p1")],
        tasks: [
          { id: "old", bucketId: "inbox-me", parentId: null, deletedAt: null, position: "m" },
        ],
      },
    }),
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    isQueuedCreate: (id: string) => outbox.has(id),
    sendCreate: rs.fn(async (task: Task, o: { queue?: boolean } = {}) => {
      sent.push({ task, queue: o.queue });
      if (opts.refuse && task.title === opts.refuse) throw new Error("Refused");
      if (opts.offline) {
        outbox.add(task.id);
        return { saved: null, queued: true };
      }
      return { saved: task, queued: false };
    }),
    queueOp: rs.fn(async (_o: unknown, op: () => Promise<unknown>) => op()),
    begin: (changes: Array<{ remove: string }>) => {
      shownRemoved.push(changes.map((c) => c.remove));
      return { settle: (a: { tasks: Task[] }) => settled.push(a.tasks), fail: () => {} };
    },
  };
  /** The device sends what waited. */
  const flush = () => {
    outbox.clear();
    for (const fn of listeners) fn();
  };
  return {
    store: store as unknown as WorkspaceStore,
    raw: store,
    sent,
    flush,
    shownRemoved,
    settled,
  };
}

function fakeRuntime() {
  return {
    tasks: {
      seedInbox: rs.fn(async () => bucket("inbox-me", { isSystem: true })),
      upsertTask: rs.fn(async (t: Task) => t),
      opQueueAdd: rs.fn(async () => []),
      addReminder: rs.fn(async () => []),
      addWaiting: rs.fn(async () => []),
      deleteTask: rs.fn(async ({ taskId }: { taskId: string }) => ({ id: taskId }) as Task),
      attachTag: rs.fn(async () => ({})),
    },
    spine: { createLink: rs.fn(async () => ({})) },
  };
}

const plan = (tasks: CaptureTaskPlan[], over: Partial<CapturePlan> = {}): CapturePlan => ({
  workspaceId: WS,
  tasks,
  source: null,
  queueTop: false,
  ...over,
});

describe("runCapture through the shared store", () => {
  it("files into the Inbox the store holds, on top of it, in order", async () => {
    const { store, sent } = fakeStore();
    const runtime = fakeRuntime();
    const a = item({ title: "A" });
    const b = item({ title: "B" });
    const result = await runCapture(plan([a, b]), {
      runtime: runtime as never,
      userId: ME,
      store,
    });
    expect(result.error).toBeNull();
    expect(result.created.map((t) => t.title)).toEqual(["A", "B"]);
    expect(sent.map((s) => s.task.bucketId)).toEqual(["inbox-me", "inbox-me"]);
    const [pa, pb] = sent.map((s) => s.task.position);
    expect(pa < pb && pb < "m").toBe(true);
    expect(runtime.tasks.seedInbox).not.toHaveBeenCalled();
  });

  it("offline, tasks wait under their own ids; their links go once they're sent", async () => {
    const { store, flush, sent } = fakeStore({ offline: true });
    const runtime = fakeRuntime();
    const parent = item({
      title: "Parent",
      links: [{ ref: { type: "note", id: "n1" }, label: "N" }],
    });
    const child = item({ title: "Child", parentId: parent.id, position: "0001" });
    const result = await runCapture(plan([parent, child], { queueTop: true }), {
      runtime: runtime as never,
      userId: ME,
      store,
    });
    expect(result.created).toEqual([]);
    expect(result.queued).toEqual([parent.id, child.id]);
    // The waiting parent lines up when it's sent; its subtask doesn't.
    expect(sent.map((s) => s.queue)).toEqual([true, false]);
    expect(sent[0].task.id).toBe(parent.id);
    expect(runtime.spine.createLink).not.toHaveBeenCalled();
    flush();
    await new Promise((r) => setTimeout(r, 0));
    expect(runtime.spine.createLink).toHaveBeenCalledTimes(1);
  });

  it("⌘N in Focus puts the new tasks at the top of Up next through the store's line-up", async () => {
    const { store, raw } = fakeStore();
    const runtime = fakeRuntime();
    await runCapture(plan([item({ title: "A" })], { queueTop: true }), {
      runtime: runtime as never,
      userId: ME,
      store,
    });
    expect(raw.queueOp).toHaveBeenCalledTimes(1);
    expect(runtime.tasks.opQueueAdd).toHaveBeenCalledWith(expect.objectContaining({ at: "top" }));
  });

  it("a refusal stops the rest and is reported", async () => {
    const { store } = fakeStore({ refuse: "Bad" });
    const runtime = fakeRuntime();
    const bad = item({ title: "Bad" });
    const kid = item({ title: "Kid", parentId: bad.id, position: "1" });
    const result = await runCapture(plan([bad, kid]), {
      runtime: runtime as never,
      userId: ME,
      store,
    });
    expect((result.error as Error).message).toBe("Refused");
    expect(result.created).toEqual([]);
    expect(result.queued).toEqual([]);
  });

  it("one Undo hides the batch at once, deletes subtasks first, and keeps what was deleted gone", async () => {
    const { store, shownRemoved, settled } = fakeStore();
    const runtime = fakeRuntime();
    const parent = { id: "p", parentId: null } as Task;
    const child = { id: "c", parentId: "p" } as Task;
    const { deleted, error } = await undoCapture(
      { runtime: runtime as never, userId: ME, store },
      WS,
      [parent, child],
    );
    expect(error).toBeNull();
    expect(shownRemoved).toEqual([["p", "c"]]);
    expect(runtime.tasks.deleteTask.mock.calls.map(([a]) => a.taskId)).toEqual(["c", "p"]);
    expect(settled[0].map((t) => t.id)).toEqual(deleted.map((t) => t.id));
  });
});
