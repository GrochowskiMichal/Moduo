// Creating what a capture holds (TV-U14), through the workspace's shared store
// (TV-D11a): every task shows at once on every surface, goes to the server
// under an id minted here, and when the connection is gone it waits on the
// device under that id and is sent once it's back (default g; no duplicate).
// Then, per task once it exists: its tags, its links (the linked things in
// its title and the "From:" item), its reminder, what it's waiting on, and a
// place at the top of Up next when asked.

import type { CaptureSource } from "../../../lib/capture-source";
import type { EntityRef } from "../../../lib/entity-links";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { isNetworkError } from "../../../lib/sync/network";
import type { WorkspaceStore } from "../../../lib/sync/store";
import { dueOnToLocalInstant } from "../../../lib/task-rows";
import { attachTag, createOrAttachByName, type TagContext } from "../../tags/store";
import { makeTask, positionsBefore } from "../helpers";
import type { PriorityLevel, RecurrenceRule, Task } from "../model";

/** One task a capture makes. Parents come before their subtasks. */
export type CaptureTaskPlan = {
  /** Minted here: a resend with it lands the same task. */
  id: string;
  title: string;
  description: string;
  /** The project; "" for your Inbox. */
  projectId: string;
  sectionId: string | null;
  teamId: string | null;
  /** Undefined: you (the creator). Null: nobody. */
  assigneeId: string | null | undefined;
  parentId: string | null;
  /** A subtask's place under its parent; "" puts a top-level task first in its list (default h). */
  position: string;
  dueDay: string | null;
  scheduledAt: string | null;
  recurrence: RecurrenceRule | null;
  priority: PriorityLevel | null;
  estimateMinutes: number | null;
  /** Tags by id, and new ones by name. */
  tags: Array<{ id: string | null; name: string }>;
  /** Linked things from the title (they stay as words, 92). */
  links: Array<{ ref: EntityRef; label: string }>;
  /** Link the "From:" item (93). */
  fromSource: boolean;
  /** "Remind me at…" (ISO), yours. */
  remindAt: string | null;
  /** Waiting on these people. */
  waitingOn: string[];
};

export type CapturePlan = {
  workspaceId: string;
  tasks: CaptureTaskPlan[];
  /** The email, note, event or contact that rides along (null once removed). */
  source: CaptureSource | null;
  /** Put the top-level tasks at the top of my Up next (⌘N in Focus), in order. */
  queueTop: boolean;
};

/** A new id for a task (the create op takes the client's). */
export function newTaskId(): string {
  return crypto.randomUUID();
}

/** The model row the create op takes. */
export function planToTask(workspaceId: string, plan: CaptureTaskPlan): Task {
  const task = makeTask({
    workspaceId,
    bucketId: plan.projectId,
    title: plan.title,
    description: plan.description,
    position: plan.position,
    parentId: plan.parentId,
    assigneeId: plan.assigneeId,
    // The day it stands for, at local midnight (the app's due date reading).
    dueDate: dueOnToLocalInstant(plan.dueDay),
    scheduledAt: plan.scheduledAt ?? plan.recurrence?.nextOccurrence ?? null,
    recurrence: plan.recurrence,
    priority: plan.priority,
    estimateMinutes: plan.estimateMinutes ?? undefined,
  });
  task.id = plan.id;
  if (plan.dueDay) task.dueOn = plan.dueDay;
  if (plan.sectionId) task.sectionId = plan.sectionId;
  if (plan.teamId) task.teamId = plan.teamId;
  return task;
}

export type CaptureResult = {
  /** Tasks the server has, in the plan's order (parents first). */
  created: Task[];
  /** Ids waiting on this device to be sent (offline): their extras follow once they're sent. */
  queued: string[];
  /** What stopped it, if the server refused something; the tasks after it weren't sent. */
  error: unknown;
  /** Extras that didn't save (a link, a reminder): the tasks are there, these aren't. */
  extrasFailed: number;
};

export type CaptureDeps = {
  runtime: ModuoRuntime;
  userId: string | null;
  /** The workspace's shared store; without one (no Tasks read) straight to the server. */
  store: WorkspaceStore | null;
};

/** How many saves a capture of many sends at once. */
const AT_ONCE = 6;

/**
 * Run `work` over `items`, a few at a time, in order of start. Stops starting
 * new ones after the first that throws (the ones running finish).
 */
async function inBatches<T>(
  items: readonly T[],
  work: (item: T) => Promise<void>,
): Promise<unknown> {
  let failure: unknown = null;
  let next = 0;
  const lane = async () => {
    while (failure === null && next < items.length) {
      const item = items[next++];
      try {
        await work(item);
      } catch (error) {
        if (failure === null) failure = error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, items.length) }, lane));
  return failure;
}

/** Resolves once a waiting create has been sent (true), or the store stopped (false). */
function whenSent(store: WorkspaceStore, taskId: string): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    let off: () => void = () => {};
    const check = () => {
      if (done) return;
      if (store.isDisposed() || !store.isQueuedCreate(taskId)) {
        done = true;
        off();
        resolve(!store.isDisposed());
      }
    };
    off = store.subscribe(check);
    check();
  });
}

/**
 * Where the plan's tasks go: "" becomes your Inbox, and each top-level task
 * gets a key before the first task of its list, in the plan's order.
 */
async function place(plan: CapturePlan, deps: CaptureDeps): Promise<CaptureTaskPlan[]> {
  const { runtime, userId, store } = deps;
  if (store) await store.whenLoaded();
  const bundle = store && !store.isDisposed() ? store.getSnapshot().bundle : null;
  const systems = (bundle?.buckets ?? []).filter((b) => b.isSystem && !b.deletedAt);
  let inboxId = (systems.find((b) => b.ownerId === userId) ?? systems[0])?.id ?? "";
  if (!inboxId && plan.tasks.some((t) => !t.projectId)) {
    inboxId = (await runtime.tasks.seedInbox(plan.workspaceId)).id;
  }
  const tasks = plan.tasks.map((t) => ({ ...t, projectId: t.projectId || inboxId }));
  const tops = new Map<string, CaptureTaskPlan[]>();
  for (const t of tasks) {
    if (t.parentId || t.position) continue;
    tops.set(t.projectId, [...(tops.get(t.projectId) ?? []), t]);
  }
  for (const [bucketId, list] of tops) {
    let first: string | null = null;
    for (const t of bundle?.tasks ?? []) {
      if (t.bucketId !== bucketId || t.parentId || t.deletedAt) continue;
      if (first === null || t.position < first) first = t.position;
    }
    const keys = positionsBefore(list.length, first);
    list.forEach((t, i) => {
      t.position = keys[i];
    });
  }
  return tasks;
}

/**
 * Make every task in the plan, then its extras: the top-level tasks first, a
 * few at a time, then the subtasks of the ones that were made (or are waiting
 * to be sent, which the store sends in order). Stops at the first task the
 * server refuses; the ones made stay made.
 */
export async function runCapture(plan: CapturePlan, deps: CaptureDeps): Promise<CaptureResult> {
  const { runtime, userId, store } = deps;
  const { workspaceId } = plan;
  const made = new Map<string, Task>();
  const queued: string[] = [];
  let extrasFailed = 0;
  const tagCtx: TagContext = { runtime, workspaceId, userId };
  // The "From:" item joins the registry once, however many tasks link it.
  let sourceRef: Promise<EntityRef | null> | null = null;
  const source = () => {
    sourceRef ??= Promise.resolve(plan.source?.ref ?? plan.source?.resolve?.() ?? null);
    return sourceRef;
  };

  const extra = async (run: () => Promise<unknown>) => {
    try {
      await run();
    } catch {
      extrasFailed += 1;
    }
  };

  const extrasFor = async (item: CaptureTaskPlan, taskId: string, title: string) => {
    const entity = { entityType: "task", entityId: taskId };
    for (const tag of item.tags) {
      // The tag store shows these at once and says itself when one fails.
      if (tag.id) attachTag(tagCtx, entity, tag.id);
      else createOrAttachByName(tagCtx, tag.name, entity);
    }
    for (const link of item.links) {
      await extra(() =>
        runtime.spine.createLink({
          workspaceId,
          source: { type: "task", id: taskId },
          target: link.ref,
          relationKind: "mentions",
          origin: "mention",
          sourceLabel: title,
          sourceIcon: "task",
        }),
      );
    }
    if (item.fromSource && plan.source) {
      await extra(async () => {
        const target = await source();
        if (!target) return;
        await runtime.spine.createLink({
          workspaceId,
          source: { type: "task", id: taskId },
          target,
          relationKind: "spawned-from",
          origin: "manual",
          sourceLabel: title,
          sourceIcon: "task",
        });
      });
    }
    if (item.remindAt) {
      const at = item.remindAt;
      await extra(() => runtime.tasks.addReminder({ workspaceId, taskId, kind: "at", at }));
    }
    for (const person of item.waitingOn) {
      await extra(() =>
        runtime.tasks.addWaiting({ workspaceId, taskId, kind: "person", ref: person }),
      );
    }
  };

  const make = async (item: CaptureTaskPlan) => {
    const task = planToTask(workspaceId, item);
    if (store && !store.isDisposed()) {
      const { saved, queued: waiting } = await store.sendCreate(task, {
        queue: plan.queueTop && !item.parentId,
      });
      if (waiting || !saved) {
        queued.push(item.id);
        // Its extras follow once it's sent (while this app stays open).
        void whenSent(store, item.id).then((sent) => {
          if (sent) void extrasFor(item, item.id, item.title);
        });
        return;
      }
      made.set(item.id, saved);
      await extrasFor(item, saved.id, saved.title);
      return;
    }
    const saved = await runtime.tasks.upsertTask(task);
    made.set(item.id, saved);
    await extrasFor(item, saved.id, saved.title);
  };

  /**
   * Many at once (a pasted list, a task's subtasks): shown together under one
   * write, sent a few at a time, and the copy takes the saved rows in one
   * step, so every screen redraws once, not once per task. If the connection
   * goes on the way, what wasn't sent waits on the device like a single
   * capture does.
   */
  const makeMany = async (items: CaptureTaskPlan[]): Promise<unknown> => {
    if (!store || store.isDisposed() || items.length < 2 || store.isOffline()) {
      return inBatches(items, make);
    }
    const create = (task: Task) =>
      runtime.tasks.createTask ? runtime.tasks.createTask(task) : runtime.tasks.upsertTask(task);
    const shown = store.begin(
      items.map((item) => ({ table: "tasks" as const, insert: planToTask(workspaceId, item) })),
    );
    const saved: Task[] = [];
    const unsent: CaptureTaskPlan[] = [];
    let refused: unknown = null;
    let lost = false;
    await inBatches(items, async (item) => {
      if (refused !== null || lost) {
        if (lost) unsent.push(item);
        return;
      }
      try {
        const row = await create(planToTask(workspaceId, item));
        saved.push(row);
        made.set(item.id, row);
      } catch (error) {
        if (isNetworkError(error)) {
          lost = true;
          unsent.push(item);
        } else refused ??= error;
      }
    });
    shown.settle({ tasks: saved });
    if (lost) store.wentOffline();
    // Offline now: the store keeps these on the device under their ids.
    for (const item of unsent) await make(item);
    await inBatches(
      items.filter((item) => made.has(item.id)),
      async (item) => {
        const row = made.get(item.id);
        if (row) await extrasFor(item, row.id, row.title);
      },
    );
    return refused;
  };

  const tasks = await place(plan, deps);
  let error = await makeMany(tasks.filter((t) => !t.parentId));
  if (error === null) {
    const ready = new Set([...made.keys(), ...queued]);
    error = await makeMany(tasks.filter((t) => t.parentId && ready.has(t.parentId)));
  }
  // In the plan's order, parents first (what the caller names and undoes).
  const created = tasks.flatMap((t) => {
    const saved = made.get(t.id);
    return saved ? [saved] : [];
  });

  if (plan.queueTop && error === null) {
    // Top of Up next, in the order captured: the last goes in first. (A
    // capture waiting offline joins the end of the line-up when it's sent.)
    for (const task of created.filter((t) => !t.parentId).reverse()) {
      await extra(async () => {
        const add = () => runtime.tasks.opQueueAdd({ workspaceId, taskId: task.id, at: "top" });
        if (store && !store.isDisposed()) await store.queueOp(null, add);
        else await add();
      });
    }
  }
  return { created, queued, error, extrasFailed };
}

/**
 * Undo a capture of many (one Undo for the batch, default a): gone from every
 * surface at once, then deleted, subtasks first so no parent hands them up on
 * its way out. Answers with the deleted rows and what stopped it, if anything.
 */
export async function undoCapture(
  deps: CaptureDeps,
  workspaceId: string,
  created: readonly Task[],
): Promise<{ deleted: Task[]; error: unknown }> {
  const { runtime, store } = deps;
  const shown =
    store && !store.isDisposed()
      ? store.begin(created.map((t) => ({ table: "tasks" as const, remove: t.id })))
      : null;
  const deleted: Task[] = [];
  const remove = async (task: Task) => {
    deleted.push(await runtime.tasks.deleteTask({ workspaceId, taskId: task.id }));
  };
  const error =
    (await inBatches(
      created.filter((t) => t.parentId),
      remove,
    )) ??
    (await inBatches(
      created.filter((t) => !t.parentId),
      remove,
    ));
  // What was deleted stays gone; anything the server kept shows again.
  shown?.settle({ tasks: deleted });
  return { deleted, error };
}
