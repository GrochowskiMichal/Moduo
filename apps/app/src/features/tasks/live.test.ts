import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import type { ModuoRuntime } from "../../lib/runtime.types";
import { makeTask } from "./helpers";
import {
  isNewer,
  type LiveChange,
  LiveGate,
  mergeBundle,
  mergeQueue,
  parseLiveChange,
  swapTemp,
  timestampMicros,
  trackTaskCalls,
} from "./live";
import type { Task, TaskQueueEntry, TasksModuleBundle } from "./model";

// TV-D5 (D5-1, D5-2): a Realtime payload lands in the bundle; an echo of our
// own save never puts an older value back.

const WS = "11111111-1111-4111-8111-111111111111";
const T1 = "22222222-2222-4222-8222-222222222222";
const B1 = "33333333-3333-4333-8333-333333333333";
const U1 = "44444444-4444-4444-8444-444444444444";
const U2 = "55555555-5555-4555-8555-555555555555";

function taskRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: T1,
    workspace_id: WS,
    owner_id: U1,
    assignee_id: U1,
    creator_unknown: false,
    bucket_id: B1,
    parent_id: null,
    title: "Write the brief",
    description: "",
    due_date: null,
    scheduled_at: null,
    duration_minutes: null,
    time_spent_seconds: 0,
    recurrence: null,
    energy_level: null,
    priority: null,
    status: "todo",
    committed_for: null,
    commit_order: null,
    reschedule_count: 0,
    position: "000000mh34",
    created_at: "2026-10-08 10:00:00.000000+00",
    updated_at: "2026-10-08 10:00:00.000000+00",
    deleted_at: null,
    ...over,
  };
}

function task(over: Partial<Task> = {}): Task {
  return {
    ...makeTask({
      workspaceId: WS,
      bucketId: B1,
      title: "Write the brief",
      position: "000000mh34",
    }),
    id: T1,
    updatedAt: "2026-10-08T10:00:00.000000+00:00",
    ...over,
  };
}

function bundleOf(tasks: Task[], extra: Partial<TasksModuleBundle> = {}): TasksModuleBundle {
  return { buckets: [], tasks, tags: [], tagLinks: [], taskRelations: [], truncated: [], ...extra };
}

function taskChange(over: Record<string, unknown> = {}): LiveChange {
  const change = parseLiveChange("tasks", { eventType: "UPDATE", new: taskRow(over) });
  if (!change) throw new Error("unparsed");
  return change;
}

describe("timestamps", () => {
  it("reads Realtime's and PostgREST's formats to the microsecond", () => {
    const a = timestampMicros("2026-10-08 20:05:25.123456+00");
    const b = timestampMicros("2026-10-08T20:05:25.123456+00:00");
    expect(a).toBe(b);
    expect(timestampMicros("2026-10-08T20:05:25.123457Z")! - a!).toBe(1);
    expect(timestampMicros("2026-10-08T22:05:25.123456+02:00")).toBe(a);
  });

  it("orders saves that land in the same millisecond", () => {
    expect(isNewer("2026-10-08 10:00:00.000002+00", "2026-10-08T10:00:00.000001+00:00")).toBe(true);
    expect(isNewer("2026-10-08 10:00:00.000001+00", "2026-10-08T10:00:00.000001+00:00")).toBe(
      false,
    );
  });
});

describe("parseLiveChange", () => {
  it("maps an insert or update to the model, a delete to its id", () => {
    const up = parseLiveChange("tasks", { eventType: "INSERT", new: taskRow() });
    expect(up).toMatchObject({
      table: "tasks",
      kind: "upsert",
      row: { id: T1, title: "Write the brief" },
    });
    expect(parseLiveChange("tag_links", { eventType: "DELETE", old: { id: T1 } })).toEqual({
      table: "tag_links",
      kind: "delete",
      id: T1,
    });
  });

  it("ignores what it can't read", () => {
    expect(parseLiveChange("tasks", { eventType: "UPDATE", new: { id: 3 } })).toBeNull();
    expect(parseLiveChange("tasks", { eventType: "DELETE", old: {} })).toBeNull();
    expect(parseLiveChange("tasks", { eventType: "TRUNCATE" })).toBeNull();
  });
});

describe("mergeBundle (D5-1)", () => {
  it("adds a teammate's new task and applies a newer edit", () => {
    const added = mergeBundle(bundleOf([]), taskChange());
    expect(added.tasks.map((t) => t.id)).toEqual([T1]);
    const edited = mergeBundle(
      added,
      taskChange({ title: "Write the brief v2", updated_at: "2026-10-08 10:00:05+00" }),
    );
    expect(edited.tasks[0]!.title).toBe("Write the brief v2");
  });

  it("drops an older or identical row (our own echo) without a new object", () => {
    const local = bundleOf([
      task({ title: "Mine", updatedAt: "2026-10-08T10:00:09.000000+00:00" }),
    ]);
    expect(mergeBundle(local, taskChange({ updated_at: "2026-10-08 10:00:05+00" }))).toBe(local);
    expect(mergeBundle(local, taskChange({ updated_at: "2026-10-08 10:00:09+00" }))).toBe(local);
  });

  it("leaves tags, links and queue rows to their own stores", () => {
    const local = bundleOf([task()]);
    expect(mergeBundle(local, { table: "tag_links", kind: "delete", id: T1 })).toBe(local);
    expect(mergeBundle(local, { table: "task_queue", kind: "delete", id: T1 })).toBe(local);
  });

  it("removes a task deleted (softly or for good) by someone else", () => {
    const local = bundleOf([task()]);
    const soft = mergeBundle(
      local,
      taskChange({ deleted_at: "2026-10-08 10:01:00+00", updated_at: "2026-10-08 10:01:00+00" }),
    );
    expect(soft.tasks).toEqual([]);
    expect(mergeBundle(local, { table: "tasks", kind: "delete", id: T1 }).tasks).toEqual([]);
    // A deleted row we never had stays absent; a delete for an unknown id is a no-op.
    expect(
      mergeBundle(bundleOf([]), taskChange({ deleted_at: "2026-10-08 10:01:00+00" })).tasks,
    ).toEqual([]);
    expect(mergeBundle(local, { table: "tasks", kind: "delete", id: B1 })).toBe(local);
  });
});

describe("swapTemp", () => {
  it("never leaves two copies when the insert's echo landed before the response", () => {
    const echoed = task({ id: "real-1" });
    const list = [task({ id: "tmp-1" }), echoed];
    expect(swapTemp(list, "tmp-1", echoed).map((t) => t.id)).toEqual(["real-1"]);
    expect(swapTemp([task({ id: "tmp-1" })], "tmp-1", echoed).map((t) => t.id)).toEqual(["real-1"]);
  });

  it("keeps a teammate's newer copy over the older saved row", () => {
    const saved = task({ id: "real-1", title: "Mine", updatedAt: "2026-10-08T10:00:00Z" });
    const edited = task({ id: "real-1", title: "Mike's", updatedAt: "2026-10-08T10:00:05Z" });
    const out = swapTemp([task({ id: "tmp-1" }), edited], "tmp-1", saved);
    expect(out.map((t) => t.title)).toEqual(["Mike's"]);
  });
});

describe("mergeQueue", () => {
  const entry = (over: Partial<TaskQueueEntry>): TaskQueueEntry => ({
    id: "q1",
    workspaceId: WS,
    userId: U1,
    taskId: T1,
    position: "000000mh34",
    queuedAt: "2026-10-08T10:00:00Z",
    updatedAt: "2026-10-08T10:00:00Z",
    ...over,
  });
  const up = (e: TaskQueueEntry): LiveChange => ({ table: "task_queue", kind: "upsert", row: e });

  it("keeps line-up order per person, bytewise", () => {
    let q: TaskQueueEntry[] = [];
    q = mergeQueue(q, up(entry({ id: "a", taskId: "t-a", position: "000001" })));
    q = mergeQueue(q, up(entry({ id: "b", taskId: "t-b", position: "000000" })));
    q = mergeQueue(q, up(entry({ id: "c", taskId: "t-c", userId: U2, position: "0" })));
    expect(q.map((e) => e.id)).toEqual(["b", "a", "c"]);
  });

  it("replaces a person's row for the same task, and removes by id", () => {
    let q = [entry({ id: "old" })];
    q = mergeQueue(q, up(entry({ id: "new", updatedAt: "2026-10-08T10:00:01Z" })));
    expect(q.map((e) => e.id)).toEqual(["new"]);
    expect(mergeQueue(q, { table: "task_queue", kind: "delete", id: "new" })).toEqual([]);
    expect(mergeQueue(q, taskChange())).toBe(q);
  });
});

describe("LiveGate (D5-2)", () => {
  beforeEach(() => {
    rs.useFakeTimers();
  });
  afterEach(() => {
    rs.useRealTimers();
  });

  it("delivers at once when idle, holds while a call is in flight, then flushes in order", () => {
    const got: LiveChange[][] = [];
    const gate = new LiveGate((c) => got.push(c), 1_000);
    const a = taskChange({ title: "a" });
    const b = taskChange({ title: "b" });
    gate.push(a);
    expect(got).toEqual([[a]]);
    const end = gate.begin();
    gate.push(b);
    expect(got).toHaveLength(1);
    end();
    rs.advanceTimersByTime(999);
    expect(got).toHaveLength(1);
    rs.advanceTimersByTime(1);
    expect(got).toEqual([[a], [b]]);
  });

  it("keeps holding while another call starts inside the grace window", () => {
    const got: LiveChange[][] = [];
    const gate = new LiveGate((c) => got.push(c), 1_000);
    gate.begin()();
    gate.push(taskChange());
    rs.advanceTimersByTime(500);
    const end = gate.begin();
    rs.advanceTimersByTime(2_000);
    expect(got).toHaveLength(0);
    end();
    rs.advanceTimersByTime(1_000);
    expect(got).toHaveLength(1);
  });

  it("runs idle waiters after the flush, and counts only writes", () => {
    const order: string[] = [];
    const gate = new LiveGate(() => order.push("flush"), 10);
    const endRead = gate.begin({ write: false });
    expect(gate.writeSeq).toBe(0);
    const end = gate.begin();
    expect(gate.writeSeq).toBe(1);
    gate.push(taskChange());
    gate.whenIdle(() => order.push("idle"));
    end();
    // A read is still open: nothing moves.
    rs.advanceTimersByTime(50);
    expect(order).toEqual([]);
    expect(gate.busy).toBe(true);
    endRead();
    rs.advanceTimersByTime(10);
    expect(order).toEqual(["flush", "idle"]);
    expect(gate.busy).toBe(false);
  });

  it("never holds a change longer than the max hold, even on a stalled call", () => {
    const got: LiveChange[][] = [];
    const gate = new LiveGate((c) => got.push(c), 1_000, 10_000);
    gate.begin(); // never ends
    gate.push(taskChange());
    rs.advanceTimersByTime(9_999);
    expect(got).toHaveLength(0);
    rs.advanceTimersByTime(1);
    expect(got).toHaveLength(1);
    expect(gate.busy).toBe(true);
  });

  it("reset drops what it held", () => {
    const got: LiveChange[][] = [];
    const gate = new LiveGate((c) => got.push(c), 10);
    const end = gate.begin();
    gate.push(taskChange());
    gate.reset();
    end();
    rs.advanceTimersByTime(10);
    expect(got).toEqual([]);
  });
});

describe("trackTaskCalls", () => {
  it("counts every tasks call until its promise settles, rejections included", async () => {
    const gate = new LiveGate(() => {}, 0);
    let resolve!: (t: Task) => void;
    const runtime = {
      tasks: {
        updateTask: () => new Promise<Task>((r) => (resolve = r)),
        deleteTask: () => Promise.reject(new Error("nope")),
        sync: () => 7,
      },
    } as unknown as ModuoRuntime;
    const tracked = trackTaskCalls(runtime, gate);
    const pending = tracked.tasks.updateTask({ workspaceId: WS, taskId: T1, patch: {} });
    expect(gate.busy).toBe(true);
    expect(gate.writeSeq).toBe(1);
    resolve(task());
    await expect(pending).resolves.toMatchObject({ id: T1 });
    await expect(tracked.tasks.deleteTask({ workspaceId: WS, taskId: T1 })).rejects.toThrow("nope");
    expect((tracked.tasks as unknown as { sync: () => number }).sync()).toBe(7);
    expect(gate.writeSeq).toBe(3);
  });
});
