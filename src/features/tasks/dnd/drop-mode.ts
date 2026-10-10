// Where a List drag lands (tasks-v3 §4, TV-U4). Pure: no React, no DOM, no IO.
//
// One gesture, two outcomes, decided from the raw pointer (the notes tree's
// `resolveDrop` pattern):
//   • pointer LEFT of the subtask indent (NEST_INDENT_PX into the row) →
//     reorder, drawn as an insertion line on the hovered row's top or bottom;
//   • pointer RIGHT of it → make it a subtask of the hovered row (the row
//     tints, a "Make subtask" preview shows under it).
// Dropping into another group rewrites that group's field (status, priority,
// assignee, project). The order follows `order.ts` (default m): a reorder
// writes a position only in one project's manual order; sorted, it's refused
// and the line becomes the sorted note; across projects there's no reorder
// and no position at all, only the group's field.
//
// The page resolves the hover on every pointer move AND again at drop time
// from the same raw coordinates (dnd-kit's delta folds auto-scroll in, see
// gotchas/ui.md), so what the line shows is what the drop does.

import { betweenPositions, canNestUnder, type GroupBy } from "../helpers";
import type { PriorityLevel, Task, TaskStatus } from "../model";
import type { DragOrder } from "../order";

/** How far into a row (px) the pointer must be to nest instead of reorder.
 *  The nested-row indent (`ml-10`), so the zone edge is where a subtask's
 *  checkbox would sit. */
export const NEST_INDENT_PX = 40;

type DragTask = Pick<Task, "id" | "parentId" | "bucketId">;

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
  /** A reorder a sorted Order refuses: the sorted note takes the line's place. */
  | { kind: "sorted"; line: { id: string; edge: "top" | "bottom" } }
  /** Make the dragged task a subtask of `targetId`. */
  | { kind: "nest"; targetId: string }
  /**
   * Into a group as a whole: its field changes. From the group's header
   * (`place`, manual order only) the task goes first in it; otherwise it
   * keeps its place in the order.
   */
  | { kind: "group"; groupKey: string; parentId: string | null; place: boolean };

/**
 * Whether a task may be dropped into another group, whose field it then
 * takes. Never a group without a field to write (Date: Upcoming's day drop is
 * its own block), a former member's (they can't take tasks), or the Inbox
 * for a task from a project: the Inbox is private, and a shared task never
 * turns private by a drop (tasks-v3 §edge cases).
 */
export function groupAccepts(
  groupBy: GroupBy,
  key: string,
  active: Pick<Task, "bucketId">,
  ctx: { inboxId: string | null; assignableIds: ReadonlySet<string> },
): boolean {
  switch (groupBy) {
    case "status":
    case "priority":
      return true;
    case "assignee":
      return key === NO_ASSIGNEE || ctx.assignableIds.has(key);
    case "bucket":
      return canMoveInto(key, active, ctx.inboxId);
    default:
      return false;
  }
}

/** A task can move to a project; into the Inbox only from the Inbox. */
export function canMoveInto(
  bucketId: string,
  active: Pick<Task, "bucketId">,
  inboxId: string | null,
): boolean {
  return bucketId !== inboxId || active.bucketId === inboxId;
}

/** The assignee grouping's "No assignee" key (`groupKeyFor`). */
const NO_ASSIGNEE = "none";

export function resolveListHover(input: {
  active: DragTask;
  /** The dragged row is a subtask nested under its parent in this view. */
  activeNested: boolean;
  /** The group key the active task's own field puts it in (`groupKeyFor`). */
  activeGroupKey: string;
  hasChildren: (id: string) => boolean;
  pointer: { x: number; y: number };
  over: ListPointerTarget | null;
  /** How this view treats the order (`dragOrderFor`). */
  order: DragOrder;
  /** Whether the task may move into another group (`groupAccepts`). */
  accepts: (groupKey: string) => boolean;
  /** Whether it may become a subtask of `parent` (the parent's project). */
  canNestInto: (parent: DragTask) => boolean;
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

  if (over.type === "group") {
    if (over.groupKey !== activeGroupKey) {
      if (!input.accepts(over.groupKey)) return null;
      return {
        kind: "group",
        groupKey: over.groupKey,
        parentId: topLevelParent,
        place: order === "manual",
      };
    }
    // Its own group's header: first in the group (manual order), or out of
    // its parent into the group (any order).
    if (order === "manual") {
      return { kind: "group", groupKey: over.groupKey, parentId: topLevelParent, place: true };
    }
    return activeNested
      ? { kind: "group", groupKey: over.groupKey, parentId: null, place: false }
      : null;
  }

  const target = over.task;
  if (target.id === active.id) return null;

  // Right of the indent on a top-level row → nest, when the one-level rule
  // and the parent's project allow it; otherwise it reads as a reorder (a
  // parent dragged by its middle must still reorder).
  const inNestZone = pointer.x >= over.rect.left + NEST_INDENT_PX;
  if (
    over.depth === 0 &&
    inNestZone &&
    canNestUnder(active, target, hasChildren) &&
    input.canNestInto(target)
  ) {
    return { kind: "nest", targetId: target.id };
  }

  const lower = pointer.y >= over.rect.top + over.rect.height / 2;

  if (over.depth === 1) {
    // Among a parent's subtasks: the task becomes (or stays) one of them.
    const parentId = target.parentId ?? null;
    if (!parentId || parentId === active.id || hasChildren(active.id)) return null;
    const line = { id: target.id, edge: lower ? "bottom" : "top" } as const;
    if (order === "manual") {
      return {
        kind: "reorder",
        ref: { id: target.id, edge: lower ? "after" : "before" },
        line,
        depth: 1,
        parentId,
        groupKey: null,
      };
    }
    if (currentParent === parentId) return order === "sorted" ? { kind: "sorted", line } : null;
    // Joining another parent with no place to keep: a nest under it.
    return { kind: "nest", targetId: parentId };
  }

  // A top-level slot. Below an expanded parent the next row is its first
  // subtask, so "after" draws under the last subtask (the parent's block)
  // while the task still lands right after the parent itself.
  const line =
    lower && over.lastChildId
      ? ({ id: over.lastChildId, edge: "bottom" } as const)
      : ({ id: target.id, edge: lower ? "bottom" : "top" } as const);
  const changesGroup = over.groupKey !== activeGroupKey;
  if (changesGroup && !input.accepts(over.groupKey)) return null;
  if (order === "manual") {
    return {
      kind: "reorder",
      ref: { id: target.id, edge: lower ? "after" : "before" },
      line,
      depth: 0,
      parentId: topLevelParent,
      groupKey: over.groupKey,
    };
  }
  // No place to keep (sorted, or across projects): a plain reorder is refused
  // — sorted, the note says why; across projects there's no manual order to
  // show — and a drop into another group (or out of a parent) lands in the
  // group, keeping its place in the order.
  if (!changesGroup && !activeNested) return order === "sorted" ? { kind: "sorted", line } : null;
  return { kind: "group", groupKey: over.groupKey, parentId: topLevelParent, place: false };
}

// ── turning a hover into writes ──────────────────────────────────────────────

/** The writes a List drop makes. Absent fields don't change. */
export type ListDropPlan = {
  taskId: string;
  /** New parent: an id, or null to make it top level. */
  parentId?: string | null;
  /** Manual order only. */
  position?: string;
  /** The group's field (status / priority / assignee). */
  fields?: GroupFieldPatch;
  /** Into another project: it moves there, and its subtasks follow. */
  bucketId?: string;
};

type GroupFieldPatch = Partial<Pick<Task, "status" | "priority" | "assigneeId">>;

/**
 * The field a group stands for, for a task dropped into it (into "High" =
 * priority high, into a status = that status, Won't do included; into a
 * person = assigned to them). Project groups move the task instead (see
 * {@link ListDropPlan.bucketId}). Null = this grouping has no field to write.
 */
export function groupFieldPatch(groupBy: GroupBy, key: string): GroupFieldPatch | null {
  switch (groupBy) {
    case "status":
      return { status: key as TaskStatus };
    case "priority":
      return { priority: key === "unset" ? null : (key as PriorityLevel) };
    case "assignee":
      return { assigneeId: key === NO_ASSIGNEE ? null : key };
    default:
      return null;
  }
}

/**
 * A key right next to `ref` among EVERY task, wherever it lives. Each list is
 * a filter of the one position order (all projects, done and filtered-out
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

/** Whether the task already sits at that spot in the one order. */
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
  const byId = (id: string | null | undefined) =>
    id ? (allByPosition.find((t) => t.id === id) ?? null) : null;

  if (hover.kind === "nest") {
    // A subtask lives in its parent's project: nesting across projects moves
    // it there (research §3).
    const parent = byId(hover.targetId);
    const plan: ListDropPlan = { taskId: active.id, parentId: hover.targetId };
    if (parent && parent.bucketId !== active.bucketId) plan.bucketId = parent.bucketId;
    return plan;
  }

  const plan: ListDropPlan = { taskId: active.id };
  const intoGroup = (key: string) => {
    if (key === activeGroupKey) return;
    if (groupBy === "bucket") plan.bucketId = key;
    else {
      const fields = groupFieldPatch(groupBy, key);
      if (fields) plan.fields = fields;
    }
  };
  // Lands next to `ref`. Where it already sits there nothing needs writing —
  // unless it also moves project, where an absent position would send it to
  // the project's end (the move's own rule): then it keeps the one it has.
  const placeAt = (ref: { id: string; edge: "before" | "after" }) => {
    if (alreadyThere(allByPosition, ref, active.id)) {
      if (plan.bucketId !== undefined) plan.position = active.position;
      return;
    }
    const position = positionNextTo(allByPosition, ref, active.id);
    if (position !== null) plan.position = position;
  };

  if ((active.parentId ?? null) !== hover.parentId) plan.parentId = hover.parentId;

  if (hover.kind === "group") {
    intoGroup(hover.groupKey);
    // From the header it goes first in the group (that's where the header is).
    const first = hover.place
      ? input.groupTasks(hover.groupKey).find((t) => t.id !== active.id)
      : undefined;
    if (first) placeAt({ id: first.id, edge: "before" });
  } else {
    if (hover.depth === 0 && hover.groupKey !== null) intoGroup(hover.groupKey);
    // Joining a parent in another project moves it there, like a nest.
    const parent = hover.depth === 1 ? byId(hover.parentId) : null;
    if (parent && parent.bucketId !== active.bucketId) plan.bucketId = parent.bucketId;
    placeAt(hover.ref);
  }
  // A subtask moved to another project on its own leaves its parent behind:
  // it comes out to the top level there (a subtask lives in its parent's
  // project).
  const parentAfter = plan.parentId !== undefined ? plan.parentId : (active.parentId ?? null);
  if (plan.bucketId !== undefined && parentAfter) {
    const parent = byId(parentAfter);
    if (!parent || parent.bucketId !== plan.bucketId) plan.parentId = null;
  }
  return hasWrites(plan, active) ? plan : null;
}

function hasWrites(plan: ListDropPlan, active: Task): boolean {
  return (
    plan.parentId !== undefined ||
    (plan.position !== undefined && plan.position !== active.position) ||
    plan.fields !== undefined ||
    plan.bucketId !== undefined
  );
}
