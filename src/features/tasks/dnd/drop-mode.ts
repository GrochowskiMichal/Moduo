// Where a List drag lands (tasks-v2 §8, TV-U4). Pure: no React, no DOM, no IO.
//
// One gesture, two outcomes, decided from the raw pointer (the notes tree's
// `resolveDrop` pattern, spec decision 14):
//   • pointer LEFT of the subtask indent (NEST_INDENT_PX into the row) →
//     reorder, drawn as an insertion line on the hovered row's top or bottom;
//   • pointer RIGHT of it → make it a subtask of the hovered row (the row
//     tints, a "Make subtask" preview shows under it).
// Dropping into another group rewrites that group's field (status, bucket,
// priority, energy). With a sorted Order a plain reorder is refused and the
// line becomes a quiet note; a cross-group drop still lands.
//
// The page resolves the hover on every pointer move AND again at drop time
// from the same raw coordinates (dnd-kit's delta folds auto-scroll in, see
// gotchas/ui.md), so what the line shows is what the drop does.

import type { TaskOrder } from "../display";
import { betweenPositions, canNestUnder, type GroupBy } from "../helpers";
import type { PriorityLevel, Task, TaskStatus } from "../model";

/** How far into a row (px) the pointer must be to nest instead of reorder.
 *  The nested-row indent (`ml-10`), so the zone edge is where a subtask's
 *  checkbox would sit. */
export const NEST_INDENT_PX = 40;


const ORDER_NOTE_LABEL: Record<Exclude<TaskOrder, "manual">, string> = {
  due: "due date",
  scheduled: "scheduled date",
  priority: "priority",
  created: "date created",
  updated: "last update",
};

/** The quiet note that replaces the insertion line under a sorted Order. */
export function sortedOrderNote(order: Exclude<TaskOrder, "manual">): string {
  return `Sorted by ${ORDER_NOTE_LABEL[order]} — switch to Manual to reorder`;
}

type DragTask = Pick<Task, "id" | "parentId">;

/** What the pointer is over in the List, measured at the moment of asking. */
export type ListPointerTarget =
  | {
      type: "row";
      task: DragTask;
      /** 0 = a top-level row, 1 = a subtask nested under its parent here. */
      depth: 0 | 1;
      /** The group the row is listed in (a subtask: its parent's group). */
      groupKey: string;
      /** The row's box in viewport px. */
      rect: { left: number; top: number; height: number };
      /** An expanded parent: the last of its subtasks showing beneath it. */
      lastChildId: string | null;
    }
  | { type: "group"; groupKey: string };

/** What a drop here would do, as the List draws it. */
export type ListDropHover =
  /** Reorder: the line sits on `line`; the task is placed next to `ref`. */
  | {
      kind: "reorder";
      ref: { id: string; edge: "before" | "after" };
      line: { id: string; edge: "top" | "bottom" };
      depth: 0 | 1;
      /** The new parent (null = top level) — a subtask slot's parent. */
      parentId: string | null;
      /** The group the task lands in (top level only). */
      groupKey: string | null;
    }
  /** A reorder a sorted Order refuses: the note takes the line's place. */
  | { kind: "sorted"; line: { id: string; edge: "top" | "bottom" } }
  /** Make the dragged task a subtask of `targetId`. */
  | { kind: "nest"; targetId: string }
  /**
   * Into a group as a whole: its field changes. From the group's header
   * (`place`), the task goes first in it; under a sorted Order a drop into
   * another group lands here too, with no place to keep.
   */
  | { kind: "group"; groupKey: string; parentId: string | null; place: boolean };

export function resolveListHover(input: {
  active: DragTask;
  /** The dragged row is a subtask nested under its parent in this view. */
  activeNested: boolean;
  /** The group key the active task's own field puts it in (`groupKeyFor`). */
  activeGroupKey: string;
  hasChildren: (id: string) => boolean;
  pointer: { x: number; y: number };
  over: ListPointerTarget | null;
  order: TaskOrder;
}): ListDropHover | null {
  const { active, activeNested, activeGroupKey, hasChildren, pointer, over, order } = input;
  if (!over) return null;

  // Where the task sits now, in this view's terms: its parent when nested
  // here; top level otherwise (a subtask whose parent isn't in this scope is
  // listed top level and keeps its parent when reordered among them).
  const currentParent = activeNested ? (active.parentId ?? null) : null;
  // At top level: keep a not-nested-here subtask's parent (reordering it among
  // top-level rows mustn't quietly un-nest it); a nested one comes out.
  const topLevelParent = activeNested ? null : (active.parentId ?? null);
  const sorted = order !== "manual";

  if (over.type === "group") {
    if (sorted && over.groupKey === activeGroupKey && !activeNested) return null;
    return { kind: "group", groupKey: over.groupKey, parentId: topLevelParent, place: !sorted };
  }

  const target = over.task;
  if (target.id === active.id) return null;

  // Right of the indent on a top-level row → nest, when the one-level rule allows.
  const inNestZone = pointer.x >= over.rect.left + NEST_INDENT_PX;
  if (over.depth === 0 && inNestZone && canNestUnder(active, target, hasChildren)) {
    return { kind: "nest", targetId: target.id };
  }

  const lower = pointer.y >= over.rect.top + over.rect.height / 2;

  if (over.depth === 1) {
    // Among a parent's subtasks: the task becomes (or stays) one of them.
    const parentId = target.parentId ?? null;
    if (!parentId || parentId === active.id || hasChildren(active.id)) return null;
    const line = { id: target.id, edge: lower ? "bottom" : "top" } as const;
    if (sorted && currentParent === parentId) return { kind: "sorted", line };
    return {
      kind: "reorder",
      ref: { id: target.id, edge: lower ? "after" : "before" },
      line,
      depth: 1,
      parentId,
      groupKey: null,
    };
  }

  // A top-level slot. Below an expanded parent the next row is its first
  // subtask, so "after" draws under the last subtask (the parent's block)
  // while the task still lands right after the parent itself.
  const line =
    lower && over.lastChildId
      ? ({ id: over.lastChildId, edge: "bottom" } as const)
      : ({ id: target.id, edge: lower ? "bottom" : "top" } as const);
  const changesGroup = over.groupKey !== activeGroupKey;
  if (sorted) {
    // A sorted list has no place to keep: a plain reorder is refused, and a
    // drop into another group (or out of a parent) lands in the group.
    if (!changesGroup && !activeNested) return { kind: "sorted", line };
    return { kind: "group", groupKey: over.groupKey, parentId: topLevelParent, place: false };
  }
  return {
    kind: "reorder",
    ref: { id: target.id, edge: lower ? "after" : "before" },
    line,
    depth: 0,
    parentId: topLevelParent,
    groupKey: over.groupKey,
  };
}

// ── turning a hover into writes ──────────────────────────────────────────────

/** The writes a List drop makes. Absent fields don't change. */
export type ListDropPlan = {
  taskId: string;
  /** New parent: an id, or null to make it top level. */
  parentId?: string | null;
  /** Manual order only. */
  position?: string;
  /** The group's field (status / priority / energy). */
  fields?: Partial<Pick<Task, "status" | "priority">>;
  /** Grouped by bucket: move it (its subtasks follow). */
  bucketId?: string;
};

/**
 * The field a group stands for, for a task dropped into it (tasks-v2 §8:
 * into "High" = priority high, into a status = status). Bucket groups move
 * the task instead (see {@link ListDropPlan.bucketId}). Null = this grouping
 * has no field to write.
 */
export function groupFieldPatch(
  groupBy: GroupBy,
  key: string,
): Partial<Pick<Task, "status" | "priority">> | null {
  switch (groupBy) {
    case "status":
      return key === "archived" ? null : { status: key as TaskStatus };
    case "priority":
      return { priority: key === "unset" ? null : (key as PriorityLevel) };
    default:
      return null;
  }
}

/**
 * A key right next to `ref` among EVERY task, wherever it lives. Each list is
 * a filter of the one position order (all buckets, done and filtered-out
 * tasks included), so landing next to `ref` there lands next to it in every
 * view, and the key can never equal a hidden task's (TV-U1's rule).
 */
export function positionNextTo(
  allByPosition: ReadonlyArray<Pick<Task, "id" | "position">>,
  ref: { id: string; edge: "before" | "after" },
  movingId: string,
): string | null {
  const rest = allByPosition.filter((t) => t.id !== movingId);
  const i = rest.findIndex((t) => t.id === ref.id);
  if (i < 0) return null;
  return ref.edge === "before"
    ? betweenPositions(rest[i - 1]?.position ?? null, rest[i].position)
    : betweenPositions(rest[i].position, rest[i + 1]?.position ?? null);
}

/** Whether the task already sits at that spot (a no-op drop). */
function alreadyThere(
  allByPosition: ReadonlyArray<Pick<Task, "id">>,
  ref: { id: string; edge: "before" | "after" },
  movingId: string,
): boolean {
  const i = allByPosition.findIndex((t) => t.id === movingId);
  const j = allByPosition.findIndex((t) => t.id === ref.id);
  if (i < 0 || j < 0) return false;
  return ref.edge === "before" ? i === j - 1 : i === j + 1;
}

export function planListDrop(input: {
  hover: ListDropHover;
  active: Task;
  activeGroupKey: string;
  groupBy: GroupBy;
  /** Every task, in position order. */
  allByPosition: ReadonlyArray<Task>;
  /** Each group's tasks in order, hidden completed ones included. */
  groupTasks: (groupKey: string) => ReadonlyArray<Pick<Task, "id">>;
}): ListDropPlan | null {
  const { hover, active, activeGroupKey, groupBy, allByPosition } = input;
  if (hover.kind === "sorted") return null;
  if (hover.kind === "nest") return { taskId: active.id, parentId: hover.targetId };

  const plan: ListDropPlan = { taskId: active.id };
  const intoGroup = (key: string) => {
    if (key === activeGroupKey) return;
    if (groupBy === "bucket") plan.bucketId = key;
    else {
      const fields = groupFieldPatch(groupBy, key);
      if (fields) plan.fields = fields;
    }
  };

  if ((active.parentId ?? null) !== hover.parentId) plan.parentId = hover.parentId;

  if (hover.kind === "group") {
    intoGroup(hover.groupKey);
    // From the header it goes first in the group (that's where the header is).
    const first = hover.place
      ? input.groupTasks(hover.groupKey).find((t) => t.id !== active.id)
      : undefined;
    if (first) {
      const ref = { id: first.id, edge: "before" } as const;
      const position = alreadyThere(allByPosition, ref, active.id)
        ? null
        : positionNextTo(allByPosition, ref, active.id);
      if (position !== null) plan.position = position;
    }
    return hasWrites(plan) ? plan : null;
  }

  if (hover.depth === 0 && hover.groupKey !== null) intoGroup(hover.groupKey);
  if (!alreadyThere(allByPosition, hover.ref, active.id)) {
    const position = positionNextTo(allByPosition, hover.ref, active.id);
    if (position !== null) plan.position = position;
  }
  return hasWrites(plan) ? plan : null;
}

function hasWrites(plan: ListDropPlan): boolean {
  return (
    plan.parentId !== undefined ||
    plan.position !== undefined ||
    plan.fields !== undefined ||
    plan.bucketId !== undefined
  );
}
