// Creating what a capture holds (TV-U14). Every task goes through the create
// op with an id minted here, so a resend after a dropped connection lands the
// same task, never a second one (spec edge case "Offline ⌘⇧K"; the durable
// device queue is the shared store's, TV-D11a). Then, per task: its tags, its
// links (the linked things in its title and the "From:" item), its reminder,
// what it's waiting on, and a place at the top of Up next when asked.

import type { CaptureSource } from "../../../lib/capture-source";
import type { EntityRef } from "../../../lib/entity-links";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { attachTag, createOrAttachByName, type TagContext } from "../../tags/store";
import { makeTask } from "../helpers";
import type { PriorityLevel, RecurrenceRule, Task } from "../model";

/** One task a capture makes. Parents come before their subtasks. */
export type CaptureTaskPlan = {
  /** Minted here: a resend with it lands the same task. */
  id: string;
  title: string;
  description: string;
  /** The project, or your Inbox. */
  projectId: string;
  sectionId: string | null;
  teamId: string | null;
  /** Undefined: you (the creator). Null: nobody. */
  assigneeId: string | null | undefined;
  parentId: string | null;
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
    dueDate: plan.dueDay ? new Date(`${plan.dueDay}T00:00:00`).toISOString() : null,
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

/** Is this error the network, not the server saying no? (Then a resend is safe.) */
export function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /failed to fetch|network|load failed|fetch failed|offline/i.test(message);
}

export type CaptureResult = {
  /** Every task created, parents first (also any a resend found already made). */
  created: Task[];
  /** What stopped it, if something did; the tasks after it weren't sent. */
  error: unknown;
  /** Extras that didn't save (a tag, a link): the tasks are there, these aren't. */
  extrasFailed: number;
};

export type CaptureDeps = {
  runtime: ModuoRuntime;
  userId: string | null;
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

/**
 * Make every task in the plan, then its extras: the top-level tasks first, a
 * few at a time, then the subtasks of the ones that were made. Stops at the
 * first task the server refuses or the network drops; the ones made stay
 * made, and the same plan sent again picks up where it stopped (same ids).
 */
export async function runCapture(plan: CapturePlan, deps: CaptureDeps): Promise<CaptureResult> {
  const { runtime, userId } = deps;
  const { workspaceId } = plan;
  const made = new Map<string, Task>();
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

  const make = async (item: CaptureTaskPlan) => {
    const saved = await runtime.tasks.upsertTask(planToTask(workspaceId, item));
    made.set(item.id, saved);
    const entity = { entityType: "task", entityId: saved.id };
    for (const tag of item.tags) {
      if (tag.id) attachTag(tagCtx, entity, tag.id);
      else createOrAttachByName(tagCtx, tag.name, entity);
    }
    for (const link of item.links) {
      await extra(() =>
        runtime.spine.createLink({
          workspaceId,
          source: { type: "task", id: saved.id },
          target: link.ref,
          relationKind: "mentions",
          origin: "mention",
          sourceLabel: saved.title,
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
          source: { type: "task", id: saved.id },
          target,
          relationKind: "spawned-from",
          origin: "manual",
          sourceLabel: saved.title,
          sourceIcon: "task",
        });
      });
    }
    if (item.remindAt) {
      const at = item.remindAt;
      await extra(() =>
        runtime.tasks.addReminder({ workspaceId, taskId: saved.id, kind: "at", at }),
      );
    }
    for (const person of item.waitingOn) {
      await extra(() =>
        runtime.tasks.addWaiting({ workspaceId, taskId: saved.id, kind: "person", ref: person }),
      );
    }
  };

  const tops = plan.tasks.filter((t) => !t.parentId);
  let error = await inBatches(tops, make);
  if (error === null) {
    const subtasks = plan.tasks.filter((t) => t.parentId && made.has(t.parentId));
    error = await inBatches(subtasks, make);
  }
  // In the plan's order, parents first (what the caller announces and undoes).
  const created = plan.tasks.flatMap((t) => {
    const saved = made.get(t.id);
    return saved ? [saved] : [];
  });

  if (plan.queueTop && error === null) {
    // Top of Up next, in the order captured: the last goes in first.
    for (const task of created.filter((t) => !t.parentId).reverse()) {
      await extra(() => runtime.tasks.opQueueAdd({ workspaceId, taskId: task.id, at: "top" }));
    }
  }
  return { created, error, extrasFailed };
}

/**
 * Undo a capture of many (one Undo for the batch, default a): subtasks first,
 * so no parent hands them up on its way out. Answers with the deleted rows
 * (and what stopped it, if something did).
 */
export async function undoCapture(
  runtime: ModuoRuntime,
  workspaceId: string,
  created: readonly Task[],
): Promise<{ deleted: Task[]; error: unknown }> {
  const deleted: Task[] = [];
  const remove = async (task: Task) => {
    deleted.push(await runtime.tasks.deleteTask({ workspaceId, taskId: task.id }));
  };
  const failed =
    (await inBatches(
      created.filter((t) => t.parentId),
      remove,
    )) ??
    (await inBatches(
      created.filter((t) => !t.parentId),
      remove,
    ));
  return { deleted, error: failed };
}
