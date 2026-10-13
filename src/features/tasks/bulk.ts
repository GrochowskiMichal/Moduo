// Bulk edits on a selection (tasks-v3 §4, calls 82b and default e; TV-U12).
// Pure: no React, no IO. A bar action, a key, the panel's "Mixed" editor or a
// drag of several tasks turns into one `BulkChange`; `planBulk` turns it into
// one write per task (skipping the tasks it wouldn't change), and
// `useBulkOps.bulkWrite` saves them as one store write with one Undo.

import {
  isClosedTask,
  legacyTaskStatus,
  type TaskStatusCategory,
  taskCategoryOf,
} from "@contracts/vocabularies";
import { dueOnToLocalInstant, localDayOf } from "../../lib/task-rows";
import { formatDay } from "../../lib/time-format";
import type { TaskDropWrite } from "./dnd/drop-write";
import { projectMoveWrite } from "./dnd/rail-drop";
import { betweenPositions, PRIORITY_LABELS, todayStr } from "./helpers";
import type { PriorityLevel, ProjectStatus, RecurrenceRule, Task } from "./model";
import { changePatternRule } from "./recurrence-engine";
import { CATEGORY_LABELS, type StatusKey, type StatusTarget } from "./statuses";

/**
 * One task's part of a bulk change: a drop's write (TV-U4's fields, saved in
 * the same order) plus the date fields a drop never carries.
 */
export type BulkWrite = TaskDropWrite & {
  /** A new due date (the local instant `Task.dueDate` holds); null clears it. */
  dueDate?: string | null;
  /** A repeat's one occurrence moves to this day (`tasks_op_move_occurrence`);
   *  its pattern stays. */
  occurrenceOn?: string;
  /** A repeat's pattern, changed with its date ("Change the patterns"). */
  recurrence?: RecurrenceRule | null;
};

/** Where a bulk Date goes: a day, each task's own date moved by n days, or none. */
export type BulkDate = { day: string } | { shift: number } | { clear: true };

/** What a repeat does under a bulk Date (spec edge case): its occurrence, by default. */
export type RepeatChoice = "one" | "pattern";

export type BulkChange =
  /** Space: finish them (their open subtasks too, call 87), or reopen them all
   *  when every one is closed already. */
  | { kind: "complete" }
  | { kind: "status"; target: StatusTarget }
  | { kind: "assign"; assigneeId: string | null }
  | { kind: "priority"; priority: PriorityLevel | null }
  | { kind: "project"; bucketId: string }
  /** A section of `projectId`; null clears the section of every task. */
  | { kind: "section"; sectionId: string | null; projectId: string | null }
  | { kind: "team"; teamId: string | null }
  | { kind: "date"; to: BulkDate; repeats?: RepeatChoice };

/** What the planner looks things up in. */
export type BulkContext = {
  /** Every task, in position order (a finished parent's subtasks, a move's place). */
  all: readonly Task[];
  /** A project's status set (the Inbox's is the workspace default). */
  statusesFor: (bucketId: string) => readonly ProjectStatus[];
  names: BulkNames;
  now: Date;
  /** The recurrence engine's zone (a pattern change keeps its weekday there). */
  zone: string;
};

/** Names the toast says, looked up by the page. */
export type BulkNames = {
  project: (id: string) => string;
  person: (id: string) => string;
  /** A section's name; null: "No section". */
  section: (id: string | null) => string;
  /** A team's name; null: "No team". */
  team: (id: string | null) => string;
};

export type BulkPlan = {
  writes: BulkWrite[];
  /** Tasks the change brought along (a finished parent's open subtasks). */
  followers: ReadonlySet<string>;
  /** What the toast says once `main` of the selected tasks and `followers`
   *  of the ones brought along changed. */
  label: (main: number, followers: number) => string;
};

/** "1 task", "4 tasks". */
export function tasksWord(n: number): string {
  return n === 1 ? "1 task" : `${n} tasks`;
}

/** A task's due day ("2026-10-13"), or null. */
export function dueDayOf(task: Pick<Task, "dueOn" | "dueDate">): string | null {
  return task.dueOn ?? localDayOf(task.dueDate);
}

/** A day key `days` after another, on the local calendar. */
export function shiftDayKey(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return todayStr(new Date(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days));
}

/** "Tomorrow", "Thu", "Oct 30" for a day key. */
export function dayWordOf(day: string, now: Date): string {
  const [y, m, d] = day.split("-").map(Number);
  return formatDay(new Date(y ?? 0, (m ?? 1) - 1, d ?? 1), now);
}

const statusKeyFor = (category: TaskStatusCategory): StatusKey =>
  category === "backlog" ? "backlog" : legacyTaskStatus(category);

/**
 * `count` places at the end of a project, one after another: where tasks
 * moved there land (TV-U4's `bucketEndPosition`, for several).
 */
export function endPositions(
  count: number,
  bucketId: string,
  allByPosition: ReadonlyArray<Pick<Task, "id" | "bucketId" | "position">>,
  moving: ReadonlySet<string>,
): string[] {
  const rest = allByPosition.filter((t) => !moving.has(t.id));
  let lastIdx = -1;
  rest.forEach((t, i) => {
    if (t.bucketId === bucketId) lastIdx = i;
  });
  let prev = lastIdx < 0 ? (rest[rest.length - 1]?.position ?? null) : rest[lastIdx].position;
  const next = lastIdx < 0 ? null : (rest[lastIdx + 1]?.position ?? null);
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const p = betweenPositions(prev, next);
    out.push(p);
    prev = p;
  }
  return out;
}

/**
 * `count` places right after `after`, before the next task that isn't moving:
 * where the rest of a dragged selection lands behind the task you held.
 */
export function positionsAfter(
  after: string,
  count: number,
  allByPosition: ReadonlyArray<Pick<Task, "id" | "position">>,
  moving: ReadonlySet<string>,
): string[] {
  let next: string | null = null;
  for (const t of allByPosition) {
    if (moving.has(t.id) || t.position <= after) continue;
    if (next === null || t.position < next) next = t.position;
  }
  const out: string[] = [];
  let prev = after;
  for (let i = 0; i < count; i += 1) {
    const p = betweenPositions(prev, next);
    out.push(p);
    prev = p;
  }
  return out;
}

/** Open subtasks a finished parent takes along (call 87), not already chosen. */
function finishFollowers(
  parents: readonly Task[],
  all: readonly Task[],
  chosen: ReadonlySet<string>,
): Task[] {
  const finishing = new Set(
    parents.filter((p) => !p.parentId && !p.recurrence && !isClosedTask(p)).map((p) => p.id),
  );
  if (finishing.size === 0) return [];
  return all.filter(
    (t) =>
      t.parentId !== null &&
      finishing.has(t.parentId) &&
      !chosen.has(t.id) &&
      !t.deletedAt &&
      !isClosedTask(t),
  );
}

/** The writes a bulk change makes, the tasks it brings along, and its words. */
export function planBulk(tasks: readonly Task[], change: BulkChange, ctx: BulkContext): BulkPlan {
  const chosen = new Set(tasks.map((t) => t.id));
  const none = new Set<string>();
  const n = tasksWord;
  switch (change.kind) {
    case "complete": {
      if (tasks.length > 0 && tasks.every(isClosedTask)) {
        return {
          writes: tasks.map((t) => ({ taskId: t.id, status: "todo" })),
          followers: none,
          label: (main) => `Reopened ${n(main)}`,
        };
      }
      const open = tasks.filter((t) => !isClosedTask(t));
      const along = finishFollowers(open, ctx.all, chosen);
      return {
        writes: [...open, ...along].map((t) => ({ taskId: t.id, status: "done" })),
        followers: new Set(along.map((t) => t.id)),
        label: (main, followers) =>
          followers > 0
            ? `Completed ${n(main)} · also ${followers === 1 ? "1 subtask" : `${followers} subtasks`}`
            : `Completed ${n(main)}`,
      };
    }
    case "status": {
      const target = change.target;
      const named =
        "statusId" in target
          ? (tasks
              .flatMap((t) => ctx.statusesFor(t.bucketId))
              .find((s) => s.id === target.statusId) ?? null)
          : null;
      const category = "statusId" in target ? (named?.category ?? null) : target.category;
      if (!category) return { writes: [], followers: none, label: () => "" };
      const key = statusKeyFor(category);
      const writes: BulkWrite[] = [];
      const moved: Task[] = [];
      for (const t of tasks) {
        // A named status goes by id to the tasks whose project has it; the
        // rest take its category (their project's first status of it).
        const own =
          "statusId" in target && ctx.statusesFor(t.bucketId).some((s) => s.id === target.statusId);
        if (own) {
          if (t.statusId === target.statusId) continue;
          writes.push({ taskId: t.id, status: key, statusId: target.statusId });
        } else {
          if (taskCategoryOf(t) === category) continue;
          writes.push({ taskId: t.id, status: key });
        }
        moved.push(t);
      }
      const along = category === "done" ? finishFollowers(moved, ctx.all, chosen) : [];
      for (const t of along) writes.push({ taskId: t.id, status: "done" });
      const name = named?.name ?? CATEGORY_LABELS[category];
      return {
        writes,
        followers: new Set(along.map((t) => t.id)),
        label: (main, followers) =>
          followers > 0
            ? `Moved ${n(main)} to ${name} · also ${followers === 1 ? "1 subtask" : `${followers} subtasks`}`
            : `Moved ${n(main)} to ${name}`,
      };
    }
    case "assign": {
      const writes = tasks
        .filter((t) => (t.assigneeId ?? null) !== change.assigneeId)
        .map((t) => ({ taskId: t.id, assigneeId: change.assigneeId }));
      const who = change.assigneeId ? ctx.names.person(change.assigneeId) : null;
      return {
        writes,
        followers: none,
        label: (main) => (who ? `Assigned ${n(main)} to ${who}` : `Unassigned ${n(main)}`),
      };
    }
    case "priority": {
      const writes = tasks
        .filter((t) => (t.priority ?? null) !== change.priority)
        .map((t) => ({ taskId: t.id, priority: change.priority }));
      const word = change.priority ? PRIORITY_LABELS[change.priority] : null;
      return {
        writes,
        followers: none,
        label: (main) =>
          word ? `Set ${n(main)} to ${word}` : `Cleared the priority of ${n(main)}`,
      };
    }
    case "project": {
      // A subtask goes with its parent when both move (the server carries it).
      const moving = tasks.filter(
        (t) =>
          t.bucketId !== change.bucketId &&
          !(t.parentId && chosen.has(t.parentId) && tasks.some((p) => p.id === t.parentId)),
      );
      const movingIds = new Set(moving.map((t) => t.id));
      for (const t of ctx.all) if (t.parentId && movingIds.has(t.parentId)) movingIds.add(t.id);
      const places = endPositions(moving.length, change.bucketId, ctx.all, movingIds);
      const byId = new Map(ctx.all.map((t) => [t.id, t]));
      const writes = moving.map((t, i) => ({
        ...projectMoveWrite(t, change.bucketId, t.parentId ? (byId.get(t.parentId) ?? null) : null),
        position: places[i],
      }));
      const where = ctx.names.project(change.bucketId);
      return { writes, followers: none, label: (main) => `Moved ${n(main)} to ${where}` };
    }
    case "section": {
      const writes = tasks
        .filter(
          (t) =>
            (change.projectId === null || t.bucketId === change.projectId) &&
            (t.sectionId ?? null) !== change.sectionId,
        )
        .map((t) => ({ taskId: t.id, sectionId: change.sectionId }));
      const where = ctx.names.section(change.sectionId);
      return { writes, followers: none, label: (main) => `Moved ${n(main)} to ${where}` };
    }
    case "team": {
      const writes = tasks
        .filter((t) => (t.teamId ?? null) !== change.teamId)
        .map((t) => ({ taskId: t.id, teamId: change.teamId }));
      const team = change.teamId ? ctx.names.team(change.teamId) : null;
      return {
        writes,
        followers: none,
        label: (main) => (team ? `Routed ${n(main)} to ${team}` : `Cleared the team of ${n(main)}`),
      };
    }
    case "date":
      return planDate(tasks, change.to, change.repeats ?? "one", ctx);
  }
}

function planDate(
  tasks: readonly Task[],
  to: BulkDate,
  repeats: RepeatChoice,
  ctx: BulkContext,
): BulkPlan {
  const today = todayStr(ctx.now);
  const writes: BulkWrite[] = [];
  const days = new Set<string>();
  for (const t of tasks) {
    const current = dueDayOf(t);
    if ("clear" in to) {
      if (current) writes.push({ taskId: t.id, dueDate: null });
      continue;
    }
    // A dateless task moves from today: "+1 day" makes it due tomorrow.
    const day = "day" in to ? to.day : shiftDayKey(current ?? today, to.shift);
    if (current === day) continue;
    days.add(day);
    if (t.recurrence && current) {
      if (repeats === "pattern") {
        const [y, m, d] = day.split("-").map(Number);
        const at = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
        writes.push({
          taskId: t.id,
          recurrence: changePatternRule(t.recurrence, at, ctx.zone),
          dueDate: dueOnToLocalInstant(day),
        });
      } else {
        writes.push({ taskId: t.id, occurrenceOn: day });
      }
      continue;
    }
    writes.push({ taskId: t.id, dueDate: dueOnToLocalInstant(day) });
  }
  const n = tasksWord;
  const label = (main: number) => {
    if ("clear" in to) return `Cleared the due date of ${n(main)}`;
    if ("day" in to || days.size <= 1) {
      const day = "day" in to ? to.day : [...days][0];
      return day ? `${n(main)} due ${dayWordOf(day, ctx.now)}` : `Moved ${n(main)}`;
    }
    // Each from its own date: "Moved 4 tasks a day later".
    const span = Math.abs(to.shift) === 7 ? "a week" : `${Math.abs(to.shift)} days`;
    const by = Math.abs(to.shift) === 1 ? "a day" : span;
    return `Moved ${n(main)} ${by} ${to.shift < 0 ? "earlier" : "later"}`;
  };
  return { writes, followers: new Set(), label };
}

/** A selection's tasks that repeat and have a due date (a bulk Date asks about them). */
export function repeatsAmong(tasks: readonly Task[]): number {
  return tasks.filter((t) => t.recurrence && dueDayOf(t)).length;
}

// ── the outcome ─────────────────────────────────────────────────────────────

/** A task the server refused, as the toast may name it (it's in the selection). */
export type BulkRefusal = {
  title: string;
  message: string;
  /** Part of its change saved before this was refused (Undo puts that back). */
  partial?: boolean;
};

/** A refusal that means the person can't edit that task. */
export function isAccessRefusal(message: string): boolean {
  return /access|read-only|permission|not found|can['’]t edit|viewer/i.test(message);
}

/**
 * What the toast says: the change, or "3 of 4 changed" with why the rest
 * didn't. A refused task is named only when it's the one (it's in the
 * selection, so it's yours to see); several are counted.
 */
export function bulkResultText(
  label: string,
  outcome: { changed: number; total: number; refused: readonly BulkRefusal[] },
): { title: string; description?: string } {
  const { changed, total, refused } = outcome;
  if (refused.length === 0) return { title: label };
  const partly = refused.some((r) => r.partial);
  const access = !partly && refused.every((r) => isAccessRefusal(r.message));
  const description =
    refused.length === 1
      ? refused[0].partial
        ? `“${refused[0].title || "Untitled"}” changed only in part: ${refused[0].message}`
        : access
          ? `“${refused[0].title || "Untitled"}” is read-only to you.`
          : `“${refused[0].title || "Untitled"}” couldn’t change: ${refused[0].message}`
      : access
        ? `${refused.length} are read-only to you.`
        : `${refused.length} ${partly ? "didn’t change fully" : "couldn’t change"}: ${refused[0].message}`;
  return {
    title:
      changed > 0
        ? `${changed} of ${total} changed`
        : partly
          ? "Changed only in part"
          : "Nothing changed",
    description,
  };
}

// ── the panel's "Mixed" ─────────────────────────────────────────────────────

export type Shared<T> = { mixed: false; value: T } | { mixed: true };

/** One value every task shares, or Mixed (call 82: as in Figma). */
export function sharedValue<T>(
  tasks: readonly Task[],
  get: (task: Task) => T,
  key: (value: T) => string = (v) => String(v ?? ""),
): Shared<T> {
  if (tasks.length === 0) return { mixed: true };
  const first = get(tasks[0]);
  const k = key(first);
  for (let i = 1; i < tasks.length; i += 1) if (key(get(tasks[i])) !== k) return { mixed: true };
  return { mixed: false, value: first };
}

/** The one project every task is in, or null when they're in several. */
export function singleProject(tasks: readonly Task[]): string | null {
  const shared = sharedValue(tasks, (t) => t.bucketId);
  return shared.mixed ? null : shared.value;
}
