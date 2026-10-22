// The Timeline's keys (TV-TL2, TV-U12): ⌥←/→ (⇧ a week), d, ⇧D, ⇧T, ⇧L, the
// cursor and fold keys, zoom, Today, the name column. A plain function the
// view calls on each key, with what it needs from its render.

import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";

import type { TasksDisplay } from "../display";
import type { Task } from "../model";
import { fitZoom } from "../timeline-drag";
import {
  isTypingTarget,
  shiftDaysOf,
  type TimelineKeyAction,
  timelineKeyAction,
} from "../timeline-keys";
import type { DaySpan, TimelineRow } from "../timeline-rows";
import { stepZoom, type TimelineRange, type TimelineZoom } from "../timeline-scale";
import type { useRowActions } from "./row-facts";
import { activateTask, type TaskCommand } from "./task-context-menu";
import type { MultiSelect } from "./use-task-selection";
import type { PendingScroll } from "./use-timeline-viewport";
import type { useTimelineWrites } from "./use-timeline-writes";

/** The keys the view keeps while several tasks are selected (the rest are the bulk bar's). */
const VIEW_KEYS_ON_A_SELECTION: ReadonlySet<TimelineKeyAction> = new Set<TimelineKeyAction>([
  "shift-earlier",
  "shift-later",
  "shift-earlier-week",
  "shift-later-week",
  "extend-next",
  "extend-prev",
  "select-all",
  "clear",
  "fit",
  "next",
  "prev",
  "today",
  "zoom-in",
  "zoom-out",
  "name-column",
  "fold",
  "unfold",
]);

export type TimelineKeyContext = {
  scrollerRef: RefObject<HTMLDivElement | null>;
  selectedIds: ReadonlySet<string>;
  selectedTaskId: string | null;
  multiSelect: MultiSelect | undefined;
  taskOrder: readonly string[];
  taskById: ReadonlyMap<string, Task>;
  rowByKey: ReadonlyMap<string, TimelineRow>;
  cursorKey: string | null;
  setCursorKey: (key: string | null) => void;
  moveCursor: (delta: 1 | -1) => void;
  canEdit: boolean;
  canDrag: boolean;
  canMoveTask: (task: Task) => boolean;
  canDragRow: (row: TimelineRow) => boolean;
  writes: ReturnType<typeof useTimelineWrites>;
  rowActions: ReturnType<typeof useRowActions>;
  lateMarks: ReadonlyMap<string, unknown>;
  setCommand: (ask: { id: string; command: TaskCommand }) => void;
  setLateOpen: (open: { id: string; at: string | null }) => void;
  pointDay: (id: string) => number | null;
  toggleRow: (key: string) => void;
  onSelectTask: (id: string | null) => void;
  onOpenTask?: (id: string) => void;
  onOpenProject?: (id: string) => void;
  onViewKey?: (event: ReactKeyboardEvent<HTMLDivElement>, selected: Task | null) => boolean;
  scrollToToday: (smooth: boolean) => void;
  changeZoom: (zoom: TimelineZoom) => void;
  toggleNameColumn: () => void;
  zoom: TimelineZoom;
  range: TimelineRange;
  dw: number;
  trackWidth: number;
  pending: { current: PendingScroll };
  display: TasksDisplay;
  onDisplayChange: (next: TasksDisplay) => void;
};

export function timelineKeyDown(ctx: TimelineKeyContext, e: ReactKeyboardEvent<HTMLDivElement>) {
  const { scrollerRef, selectedIds, selectedTaskId, taskById, rowByKey, cursorKey, onViewKey } =
    ctx;
  const scroller = scrollerRef.current;
  if (!scroller || !(e.target instanceof Node) || !scroller.contains(e.target)) return;
  if (isTypingTarget(e.target)) return;
  const action = timelineKeyAction(e);
  // A selection's own keys first (TV-U12's bar: d the date picker, Space,
  // ⌫…); the Timeline's date moves and its cursor keys stay the view's.
  if (selectedIds.size >= 2 && onViewKey && !(action && VIEW_KEYS_ON_A_SELECTION.has(action))) {
    const selectedNow = selectedTaskId ? (taskById.get(selectedTaskId) ?? null) : null;
    if (onViewKey(e, selectedNow)) {
      e.preventDefault();
      return;
    }
  }
  if (!action) return;
  const row = cursorKey ? rowByKey.get(cursorKey) : undefined;
  // A key the view didn't use keeps its native job (←/→ off a header and
  // Space with no row scroll the canvas).
  if (runKey(ctx, action, row)) e.preventDefault();
}

/** The selected tasks while two or more are, else none. */
function selectedTasks({ selectedIds, taskById }: TimelineKeyContext): Task[] {
  return selectedIds.size >= 2
    ? [...selectedIds].flatMap((id) => {
        const task = taskById.get(id);
        return task ? [task] : [];
      })
    : [];
}

/** ⇧T: bring the selection's marks into view, zooming out only if they don't fit. */
function fitSelection(ctx: TimelineKeyContext, row: TimelineRow | undefined): boolean {
  const { selectedIds, pointDay, trackWidth, zoom, range, dw, display } = ctx;
  const days: number[] = [];
  if (selectedIds.size >= 2) {
    for (const id of selectedIds) {
      const day = pointDay(id);
      if (day !== null) days.push(day);
    }
  } else if (row?.kind === "task" && row.point) days.push(row.point.day);
  else if (row?.kind === "section" && row.band) days.push(row.band.start, row.band.end);
  else if (row?.kind === "section" && row.milestone !== null) days.push(row.milestone);
  else if (row?.kind === "project" && row.bar) days.push(row.bar.start, row.bar.end);
  if (days.length === 0) return false;
  const span: DaySpan = { start: Math.min(...days), end: Math.max(...days) };
  const next = fitZoom(span, trackWidth, zoom);
  const center = (span.start + span.end + 1) / 2;
  if (next !== zoom) {
    ctx.pending.current = { kind: "day", day: center, at: trackWidth / 2 };
    ctx.onDisplayChange({ ...display, timelineZoom: next });
  } else {
    ctx.scrollerRef.current?.scrollTo({
      left: Math.max(0, (center - range.start) * dw - trackWidth / 2),
      behavior: "smooth",
    });
  }
  return true;
}

/** Run a key's action; false when it did nothing here. */
function runKey(
  ctx: TimelineKeyContext,
  action: TimelineKeyAction,
  row: TimelineRow | undefined,
): boolean {
  const {
    canDrag,
    canEdit,
    canMoveTask,
    canDragRow,
    writes,
    multiSelect,
    taskOrder,
    toggleRow,
    zoom,
    cursorKey,
  } = ctx;
  const foldable =
    row?.kind === "section" || (row?.kind === "project" && row.expandable) ? row : null;
  const shift = shiftDaysOf(action);
  if (shift !== 0) {
    // ⌥←/→ (⇧ a week): the selection, or the row under the cursor (70).
    if (!canDrag) return false;
    const several = selectedTasks(ctx);
    if (several.length > 0) {
      const movable = several.filter(canMoveTask);
      if (movable.length === 0) return false;
      writes.shiftTasks(movable, shift, several.length - movable.length);
    } else if (row?.kind === "task") {
      if (!canMoveTask(row.task)) return false;
      writes.shiftTasks([row.task], shift);
    } else if (!row || !canDragRow(row) || !writes.shiftRow(row, shift)) return false;
    return true;
  }
  switch (action) {
    case "date":
      if (row?.kind !== "task" || !canMoveTask(row.task)) return false;
      ctx.setCommand({ id: row.task.id, command: "due" });
      return true;
    case "clear-date": {
      if (!canDrag) return false;
      const several = selectedTasks(ctx);
      const asked = several.length > 0 ? several : row?.kind === "task" ? [row.task] : [];
      const targets = asked.filter(canMoveTask);
      if (targets.length === 0) return false;
      writes.clearDue(targets, asked.length - targets.length);
      return true;
    }
    case "fit":
      return fitSelection(ctx, row);
    case "late":
      // The late mark's why and its "Move to …", by keyboard (68b).
      if (row?.kind !== "task" || !ctx.lateMarks.has(row.task.id) || !canMoveTask(row.task)) {
        return false;
      }
      ctx.setLateOpen({ id: row.task.id, at: cursorKey });
      return true;
    case "extend-next":
    case "extend-prev":
      if (!multiSelect || row?.kind !== "task") return false;
      multiSelect.extend(action === "extend-next" ? 1 : -1, taskOrder);
      return true;
    case "select-all":
      if (!multiSelect || taskOrder.length === 0) return false;
      multiSelect.selectAll(taskOrder);
      return true;
    case "next":
      ctx.moveCursor(1);
      return true;
    case "prev":
      ctx.moveCursor(-1);
      return true;
    case "fold":
    case "unfold": {
      if (!foldable) return false;
      const open = foldable.kind === "project" ? foldable.expanded : !foldable.folded;
      if (open === (action === "fold")) toggleRow(foldable.key);
      return true;
    }
    case "open":
      if (row?.kind === "task") {
        ctx.onOpenTask?.(row.task.id);
        return true;
      }
      if (row?.kind === "project" && row.expandable && ctx.onOpenProject) {
        ctx.onOpenProject(row.project.id);
        return true;
      }
      if (foldable) {
        toggleRow(foldable.key);
        return true;
      }
      return false;
    case "toggle":
      if (row?.kind === "task") {
        if (canEdit) activateTask(row.task, ctx.rowActions);
        return true;
      }
      if (foldable) {
        toggleRow(foldable.key);
        return true;
      }
      return false;
    case "today":
      ctx.scrollToToday(true);
      return true;
    case "zoom-in":
      ctx.changeZoom(stepZoom(zoom, -1));
      return true;
    case "zoom-out":
      ctx.changeZoom(stepZoom(zoom, 1));
      return true;
    case "name-column":
      ctx.toggleNameColumn();
      return true;
    case "clear":
      // Esc: a selection of several first, then the cursor.
      if (multiSelect?.clear()) return true;
      ctx.setCursorKey(null);
      ctx.onSelectTask(null);
      return true;
    default:
      return false;
  }
}
