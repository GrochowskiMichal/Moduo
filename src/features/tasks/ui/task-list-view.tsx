import {
  type Announcements,
  closestCenter,
  type DragEndEvent,
  type DraggableSyntheticListeners,
  DragOverlay,
  type DragStartEvent,
  pointerWithin,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import {
  DROP_TARGET,
  DragOverlaySurface,
  InsertionLine,
  NestPreview,
  SortedNote,
} from "../../../components/ui/drag-visuals";
import { eyebrowVariants } from "../../../components/ui/eyebrow";
import { undoToast } from "../../../lib/undo-toast";
import { cn } from "../../../lib/utils";
import { useAssignees } from "../assignees";
import { type CompletedMode, partitionCompleted } from "../completed";
import { orderTasks, type RowPreset, type SubtaskMode, type TaskOrder } from "../display";
import {
  canMoveInto,
  groupAccepts,
  type ListDropHover,
  type ListDropPlan,
  type ListPointerTarget,
  NEST_INDENT_PX,
  planListDrop,
  positionNextTo,
  resolveListHover,
} from "../dnd/drop-mode";
import { type DropNames, dropLabel, type TaskDropWrite, writeFromPlan } from "../dnd/drop-write";
import { isSideDroppable } from "../dnd/rail-drop";
import {
  canNestUnder,
  type GroupBy,
  groupKeyFor,
  groupTasks,
  isOpen,
  nestedSubtaskIds,
  showBucketPill,
} from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Bucket, Task } from "../model";
import { BACK_TO_MANUAL_ORDER, dragOrderFor, sortedByLabel } from "../order";
import { DEFAULT_ROW_PROPERTIES, rowColumns } from "../row-layout";
import { nowOn, useToday } from "../use-today";
import {
  asTaskDrag,
  DndBoundary,
  type DragActivatorRef,
  DraggableTask,
  overlayBesideCursor,
  SortableTask,
  taskDragAnnouncements,
  useTaskDndSensors,
} from "./dnd/task-dnd";
import { listKeyActionFor } from "./list-keys";
import { type PlanHeaderControls, type PlanView, PlanViewHeader } from "./plan-view-header";
import { CompletedLine } from "./task-meta";
import { type RowCommand, TaskRow } from "./task-row";
import { TaskListSkeleton, TasksEmptyScope, TasksNoMatch } from "./task-view-states";

type Props = {
  tasks: Task[];
  scopeTitle: string;
  selection: string; // "all" | "mine" | "today" | "inbox" | bucketId
  view: PlanView;
  onViewChange: (view: PlanView) => void;
  /** Display → Group by (the Queue is never grouped). */
  groupBy: GroupBy;
  buckets: Bucket[];
  inbox: Bucket | null;
  bucketNameById: (id: string) => string;
  canEdit: boolean;
  onRequestCapture: () => void;
  /** Lifted task selection — drives the keyboard cursor and the detail rail. */
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  /** The toolbar's search, Filter, Display and count (built by the page). */
  header?: PlanHeaderControls;
  /** A filter is narrowing the scope: an empty result reads "No tasks match". */
  filterActive?: boolean;
  onClearFilters?: () => void;
  /** Display → Completed (tasks-v2 §6). Default: hidden. The Queue ignores it. */
  completed?: CompletedMode;
  /** Display → "Show on rows". */
  properties?: readonly string[];
  /** Display → Rows: Standard · Detailed. */
  rows?: RowPreset;
  /**
   * Display → Order by, inside each group. The Queue keeps its line-up. Only
   * Manual takes a drag reorder; a sorted list shows a quiet note instead of
   * the line, while nesting and cross-group drops still work.
   */
  order?: TaskOrder;
  /** Display → Subtasks: nested under their parent, or rows of their own. */
  subtasks?: SubtaskMode;
  /**
   * Tasks that stay listed whatever Display says, until the scope changes:
   * checked off here, or opened here (selected, deep-linked).
   */
  stayingIds?: ReadonlySet<string>;
  /** Enable drag-to-reorder (the Queue): a flat, ungrouped, ordered list. */
  reorderable?: boolean;
  /** Persist a reorder — receives the task ids in their new order, and runs
   *  `onSaved` once the server has it (the drop's Undo toast). */
  onReorder?: (orderedIds: string[], onSaved?: () => void) => void;
  /** Display → Order by back to Manual: the sorted drop toast's action. */
  onManualOrder?: () => void;
  /** One-shot deep-link reveal (DF-1): when the selection was set from outside
   * and sits in a collapsed group, expand that group exactly once. */
  revealRequest?: { id: string; seq: number } | null;
  /** "external" = an ancestor owns the DndContext (DF-22: so a center-pane task
   * row can be dragged onto the right-pane hub to link it); reorder/nest bind
   * via a monitor. Default "internal" (own DndContext) keeps stories/standalone
   * mounts working. */
  dndMode?: "internal" | "external";
  api: TasksModuleApi;
};

const NO_IDS: ReadonlySet<string> = new Set();

export function TaskListView({
  tasks,
  scopeTitle,
  selection,
  view,
  onViewChange,
  groupBy,
  buckets,
  inbox,
  bucketNameById,
  canEdit,
  onRequestCapture,
  selectedTaskId,
  onSelectTask,
  header,
  filterActive = false,
  onClearFilters,
  completed = "hidden",
  properties = DEFAULT_ROW_PROPERTIES,
  rows: rowPreset = "standard",
  order = "manual",
  subtasks = "nested",
  stayingIds = NO_IDS,
  reorderable = false,
  onReorder,
  onManualOrder,
  revealRequest = null,
  dndMode = "internal",
  api,
}: Props) {
  // Selection is owned by the parent (shared with the detail rail); these aliases
  // keep the keyboard-cursor logic below unchanged.
  const selectedId = selectedTaskId;
  const setSelectedId = onSelectTask;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [command, setCommand] = useState<{ taskId: string; kind: RowCommand } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [reordering, setReordering] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dndSensors = useTaskDndSensors();
  // List drags have no SortableContext → the default keyboard sensor.
  const dragSensors = useTaskDndSensors({ sortable: false });

  // Detailed names the project on every row (tasks-v3 §4); Standard only
  // where it isn't implied.
  const showBucketTag = rowPreset === "detailed" || showBucketPill(selection, groupBy);
  // In My tasks every row is mine, so rows leave the avatar out (D4-4).
  const showAssignee = selection !== "mine";
  const { assignees } = useAssignees();

  // Subtasks nest under their parent (hidden from the top level) unless
  // Display says Flat, and never in the Queue — an ordered flat line-up whose
  // subtasks are queued one by one. A subtask whose parent isn't in this
  // scope renders as a normal top-level row instead (never invisible).
  const nest = selection !== "today" && subtasks === "nested";
  const nestedIds = useMemo(() => nestedSubtaskIds(tasks, nest), [tasks, nest]);
  const topLevelTasks = useMemo(
    () => (nestedIds.size === 0 ? tasks : tasks.filter((t) => !nestedIds.has(t.id))),
    [tasks, nestedIds],
  );
  // Per-parent expand state (collapsed by default — quiet until asked).
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  // Reserve the chevron gutter only when this scope actually nests something,
  // so subtask-free lists look exactly as before.
  const expandSlot = nestedIds.size > 0;
  // Parent titles for subtasks rendered flat (Today, or parent out of scope).
  const taskById = useMemo(() => new Map(api.tasks.map((t) => [t.id, t])), [api.tasks]);
  const parentTitleFor = (task: Task): string | null => {
    if (!task.parentId || nestedIds.has(task.id)) return null;
    const parent = taskById.get(task.parentId);
    return parent ? parent.title || "Untitled" : null;
  };

  // Groups whose hidden completed tasks were asked for ("· show"); reset with
  // the collapse state when the scope or grouping changes.
  const [revealedGroups, setRevealedGroups] = useState<ReadonlySet<string>>(NO_IDS);

  // Completed tasks Display hides drop out of each group, behind its
  // "N completed · show" line (tasks-v2 §6). The Queue keeps its own rule:
  // done leaves it, and a task checked off there stays until the next load.
  // The Date groups and "7 days" roll over at midnight.
  const today = useToday();
  const groups = useMemo(() => {
    const now = nowOn(today);
    // Sort, then group, so every group keeps the order (the Queue keeps its
    // line-up). Project groups follow the rail; each task is in one group.
    const ordered = orderTasks(topLevelTasks, selection === "today" ? "manual" : order);
    const all = groupTasks(ordered, groupBy, {
      bucketName: bucketNameById,
      bucketOrder: [...(inbox ? [inbox.id] : []), ...buckets.map((b) => b.id)],
      assignees,
      now,
    });
    if (selection === "today") {
      return all.map((g) => ({ ...g, all: g.tasks, hidden: [] as Task[] }));
    }
    // Kept even when done: staying (checked off or opened in this scope); the
    // selected task and its parent (a deep link or the panel must never point
    // at a row that isn't there, and a subtask nests under its parent); a
    // parent with open subtasks (they nest under it).
    const selectedParentId = selectedId ? (taskById.get(selectedId)?.parentId ?? null) : null;
    const keep = (t: Task) =>
      stayingIds.has(t.id) ||
      t.id === selectedId ||
      t.id === selectedParentId ||
      (api.subtasksByParent.get(t.id) ?? []).some(isOpen);
    // `all` keeps every task of the group in order, hidden ones included:
    // a drop is placed among them (TV-U1's rule, since `position` orders both).
    return all.map((g) => {
      const { shown, hidden } = partitionCompleted(g.tasks, { mode: completed, now, keep });
      return { ...g, all: g.tasks, tasks: revealedGroups.has(g.key) ? g.tasks : shown, hidden };
    });
  }, [
    today,
    topLevelTasks,
    order,
    groupBy,
    bucketNameById,
    inbox,
    buckets,
    assignees,
    selection,
    completed,
    stayingIds,
    selectedId,
    taskById,
    revealedGroups,
    api.subtasksByParent,
  ]);

  // Reset collapse state when the scope/grouping changes. For bucket grouping,
  // open one group by default (per the "one open by default" rule); otherwise
  // everything is expanded.
  // The selected task's group stays open too (TV-P0): a deep link into All
  // lands before the bucket grouping does, and must not be folded away.
  const groupSignature = `${selection}:${groupBy}:${groups.map((g) => g.key).join(",")}`;
  const initRef = useRef("");
  const selectedForInitRef = useRef(selectedId);
  useEffect(() => {
    selectedForInitRef.current = selectedId;
  });
  useEffect(() => {
    if (initRef.current === groupSignature) return;
    initRef.current = groupSignature;
    if (groupBy === "bucket" && groups.length > 1) {
      const selected = selectedForInitRef.current;
      const parentId = selected ? taskById.get(selected)?.parentId : null;
      const holding = groups.find((g) =>
        g.tasks.some((t) => t.id === selected || (parentId && t.id === parentId)),
      )?.key;
      setCollapsed(
        new Set(
          groups
            .slice(1)
            .map((g) => g.key)
            .filter((key) => key !== holding),
        ),
      );
    } else {
      setCollapsed(new Set());
    }
    setExpandedParents(new Set());
    setRevealedGroups(NO_IDS);
  }, [groupSignature, groupBy, groups, taskById]);

  const toggleRevealGroup = useCallback((key: string) => {
    setRevealedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // The right-hand columns, from every row the view can show (the listed
  // rows and their subtasks), so the meta lines up and an empty column
  // collapses (tasks-v2 §6, U1-1).
  const columns = useMemo(() => {
    const rows: Task[] = [];
    for (const group of groups) {
      for (const task of group.tasks) {
        rows.push(task);
        if (nest) rows.push(...(api.subtasksByParent.get(task.id) ?? []));
      }
    }
    return rowColumns(rows, {
      properties,
      rows: rowPreset,
      showAssignee: showAssignee && assignees.length > 1,
      canEdit,
      isQueued: (id) => api.queuedTaskIds.has(id),
      isClaimed: (id) => (api.queueClaims.get(id)?.length ?? 0) > 0,
    });
  }, [
    groups,
    nest,
    api.subtasksByParent,
    api.queuedTaskIds,
    api.queueClaims,
    properties,
    rowPreset,
    showAssignee,
    assignees.length,
    canEdit,
  ]);

  const toggleExpandParent = useCallback((id: string) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Flat, visually-ordered list of navigable tasks (skips collapsed groups,
  // includes the children of expanded parents — keyboard order = visual order).
  // A task is one stop, at its first row (a guard: every grouping lists it once).
  const visibleTasks = useMemo(() => {
    const out: Task[] = [];
    const seen = new Set<string>();
    const push = (task: Task) => {
      if (seen.has(task.id)) return;
      seen.add(task.id);
      out.push(task);
    };
    for (const group of groups) {
      if (collapsed.has(group.key)) continue;
      for (const task of group.tasks) {
        push(task);
        // Only nested subtasks sit under their parent; Flat lists them as
        // rows of their own, in their own place.
        if (nest && expandedParents.has(task.id)) {
          for (const child of api.subtasksByParent.get(task.id) ?? []) push(child);
        }
      }
    }
    return out;
  }, [groups, collapsed, expandedParents, nest, api.subtasksByParent]);

  // Keep the selection valid as tasks change. A selected subtask under a
  // visible-but-collapsed parent isn't stolen — its parent expands into view
  // instead (the detail panel's subtask list navigates selection this way).
  // A deep link may additionally target a task inside a collapsed group
  // (DF-1): the one-shot `revealRequest` expands that group exactly once.
  // Ordinary fallbacks (complete/archive into a collapsed group, scope
  // switches) never touch collapse state — a group the user closes stays
  // closed, and the one-open-by-default rule on entering "All" holds.
  const consumedRevealSeqRef = useRef(0);
  useEffect(() => {
    const reveal =
      revealRequest &&
      revealRequest.id === selectedId &&
      consumedRevealSeqRef.current !== revealRequest.seq
        ? revealRequest
        : null;
    if (reveal) consumedRevealSeqRef.current = reveal.seq;
    if (selectedId && visibleTasks.some((t) => t.id === selectedId)) return;
    if (selectedId) {
      const parentId = taskById.get(selectedId)?.parentId;
      if (parentId && visibleTasks.some((t) => t.id === parentId)) {
        if (nest) {
          setExpandedParents((prev) => (prev.has(parentId) ? prev : new Set(prev).add(parentId)));
        }
        return;
      }
      if (reveal) {
        const collapsedGroup = groups.find(
          (g) =>
            collapsed.has(g.key) &&
            g.tasks.some((t) => t.id === selectedId || (parentId && t.id === parentId)),
        );
        if (collapsedGroup) {
          setCollapsed((prev) => {
            const next = new Set(prev);
            next.delete(collapsedGroup.key);
            return next;
          });
          return;
        }
      }
    }
    setSelectedId(visibleTasks[0]?.id ?? null);
  }, [visibleTasks, selectedId, setSelectedId, taskById, nest, groups, collapsed, revealRequest]);

  // Keyboard-first: focus the list once on mount so j/k work immediately —
  // unless focus is already somewhere intentional (an input, an open dialog).
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) containerRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const move = useCallback(
    (delta: 1 | -1) => {
      if (visibleTasks.length === 0) return;
      const idx = visibleTasks.findIndex((t) => t.id === selectedId);
      const nextIdx = idx < 0 ? 0 : Math.min(visibleTasks.length - 1, Math.max(0, idx + delta));
      setSelectedId(visibleTasks[nextIdx]?.id ?? null);
    },
    [visibleTasks, selectedId, setSelectedId],
  );

  const selectedTask = visibleTasks.find((t) => t.id === selectedId) ?? null;

  // ── drops and move keys (TV-U4) ──────────────────────────────────────────────
  // Manual order lives inside one project (order.ts, default m): a drag or a
  // move key writes a position only in a project or the Inbox under Manual.
  // Every drop ends in one Undo toast, shown once it saved (api.dropTask).
  const dragOrder = dragOrderFor(selection, order);
  const inboxId = inbox?.id ?? null;
  const assignableIds = useMemo(
    () => new Set(assignees.filter((a) => a.canTakeTasks).map((a) => a.userId)),
    [assignees],
  );
  const dropNames = useMemo<DropNames>(
    () => ({
      bucketName: bucketNameById,
      assigneeName: (id) => {
        const person = assignees.find((a) => a.userId === id);
        return person ? (person.isMe ? "you" : person.name) : "a former member";
      },
      taskTitle: (id) => taskById.get(id)?.title || "Untitled",
    }),
    [bucketNameById, assignees, taskById],
  );
  const drop = useCallback(
    (write: TaskDropWrite, before: Task, label?: string) => {
      void api.dropTask(write, label ?? dropLabel(write, dropNames, before));
    },
    [api, dropNames],
  );
  // A sorted project view asks to switch back before a reorder (default m).
  const askManualOrder = useCallback(() => {
    if (order === "manual") return;
    toast(sortedByLabel(order), {
      action: onManualOrder ? { label: BACK_TO_MANUAL_ORDER, onClick: onManualOrder } : undefined,
    });
  }, [order, onManualOrder]);
  const refuseReorder = useCallback(() => {
    if (dragOrder === "sorted") askManualOrder();
    else toast("Tasks keep their order inside each project.");
  }, [dragOrder, askManualOrder]);

  // The task's siblings as listed: its parent's subtasks when nested here,
  // else the top-level rows of its group.
  const siblingsOf = useCallback(
    (task: Task): Task[] => {
      if (task.parentId && nestedIds.has(task.id)) {
        return api.subtasksByParent.get(task.parentId) ?? [];
      }
      return groups.find((g) => g.tasks.some((t) => t.id === task.id))?.tasks ?? [];
    },
    [nestedIds, api.subtasksByParent, groups],
  );

  /** `>`: a subtask of the row above (one level; a subtask lives in its
   *  parent's project, so across projects it moves there). */
  const nestUnderAbove = useCallback(
    (task: Task) => {
      if (nestedIds.has(task.id)) return; // already a subtask here
      const siblings = siblingsOf(task);
      const above = siblings[siblings.findIndex((t) => t.id === task.id) - 1];
      if (!above) return;
      const hasKids = (id: string) => (api.subtasksByParent.get(id)?.length ?? 0) > 0;
      if (!canNestUnder(task, above, hasKids)) {
        toast(
          hasKids(task.id)
            ? "Subtasks are one level — this task has subtasks of its own."
            : "Subtasks are one level — that task is already a subtask.",
        );
        return;
      }
      if (!canMoveInto(above.bucketId, task, inboxId)) {
        toast("A project’s task can’t become a subtask of an Inbox task.");
        return;
      }
      const write: TaskDropWrite = { taskId: task.id, parentId: above.id };
      if (above.bucketId !== task.bucketId) write.bucketId = above.bucketId;
      if (nest) setExpandedParents((prev) => new Set(prev).add(above.id));
      drop(write, task);
    },
    [nestedIds, siblingsOf, api.subtasksByParent, inboxId, nest, drop],
  );

  /** `<`: out of its parent, to the top level right after the parent (where
   *  the order is manual; elsewhere it keeps its place in the order). */
  const unnest = useCallback(
    (task: Task) => {
      if (!task.parentId) return;
      const write: TaskDropWrite = { taskId: task.id, parentId: null };
      if (dragOrder === "manual") {
        const position = positionNextTo(api.tasks, { id: task.parentId, edge: "after" }, task.id);
        if (position !== null) write.position = position;
      }
      drop(write, task);
    },
    [dragOrder, api.tasks, drop],
  );

  /** ⌥⇧↑/↓: one place up or down among its siblings, in the manual order. */
  const moveInOrder = useCallback(
    (task: Task, delta: 1 | -1) => {
      if (dragOrder !== "manual") {
        refuseReorder();
        return;
      }
      const siblings = siblingsOf(task);
      const neighbour = siblings[siblings.findIndex((t) => t.id === task.id) + delta];
      if (!neighbour) return;
      const position = positionNextTo(
        api.tasks,
        { id: neighbour.id, edge: delta < 0 ? "before" : "after" },
        task.id,
      );
      if (position === null) return;
      drop({ taskId: task.id, position }, task, delta < 0 ? "Moved up" : "Moved down");
    },
    [dragOrder, refuseReorder, siblingsOf, api.tasks, drop],
  );

  // The Queue's line-up is the queue's own (`task_queue`): a drag or a move
  // key there reorders it, with the same Undo once it saved.
  const reorderQueueWithUndo = useCallback(
    (previous: string[], next: string[], label: string) => {
      onReorder?.(next, () => undoToast(label, { onUndo: () => onReorder?.(previous) }));
    },
    [onReorder],
  );
  const moveInQueue = useCallback(
    (task: Task, delta: 1 | -1) => {
      if (!reorderable) return;
      const ids = (groups[0]?.tasks ?? []).map((t) => t.id);
      const from = ids.indexOf(task.id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= ids.length) return;
      reorderQueueWithUndo(ids, arrayMove(ids, from, to), delta < 0 ? "Moved up" : "Moved down");
    },
    [reorderable, groups, reorderQueueWithUndo],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // While inline-editing a title, the Input stops propagation. During a
      // keyboard reorder the dnd sensor owns the arrows — don't also move the cursor.
      if (editingId || reordering) return;
      // Keys from a row's portaled popover or context menu, modified keys (⌘K,
      // ⌘⇧K, ⌘C… stay the app's and the OS's) and a row button's own Space/Enter
      // aren't the list's — see list-keys.ts.
      const action = listKeyActionFor(e, e.currentTarget);
      if (!action) return;
      // A list key pressed while focus sits on something inside the list (a
      // button Chromium focused on click, a title) hands focus back to the
      // list, so the next Space/Enter acts on the selected row, not that button.
      if (e.target !== e.currentTarget) e.currentTarget.focus({ preventScroll: true });
      switch (action) {
        case "next":
          e.preventDefault();
          move(1);
          return;
        case "prev":
          e.preventDefault();
          move(-1);
          return;
        case "toggle-done":
          if (!selectedTask || !canEdit) return;
          e.preventDefault();
          api.toggleDone(selectedTask);
          return;
        case "edit":
          if (!selectedTask || !canEdit) return;
          e.preventDefault();
          setEditingId(selectedTask.id);
          return;
        case "capture":
          e.preventDefault();
          onRequestCapture();
          return;
        case "bucket":
        case "schedule":
        case "due":
          if (!selectedTask || !canEdit) return;
          e.preventDefault();
          setCommand({ taskId: selectedTask.id, kind: action });
          return;
        case "queue":
          // Queue/unqueue the selected task (Round D: `q` is the queue key — was
          // `t` from when the queue was "Today"; the rename makes `q` canonical).
          if (!selectedTask || !canEdit) return;
          e.preventDefault();
          api.toggleQueue(selectedTask.id);
          return;
        case "expand":
          // expand the selected parent's subtasks
          if (!selectedTask || !nest) return;
          if ((api.subtasksByParent.get(selectedTask.id)?.length ?? 0) > 0) {
            e.preventDefault();
            setExpandedParents((prev) => new Set(prev).add(selectedTask.id));
          }
          return;
        case "collapse":
          // collapse the selected parent — or jump from a subtask to its parent
          if (!selectedTask) return;
          if (expandedParents.has(selectedTask.id)) {
            e.preventDefault();
            toggleExpandParent(selectedTask.id);
          } else if (selectedTask.parentId && nestedIds.has(selectedTask.id)) {
            e.preventDefault();
            setSelectedId(selectedTask.parentId);
          }
          return;
        case "delete":
          if (!selectedTask || !canEdit) return;
          e.preventDefault();
          api.deleteTask(selectedTask.id);
          return;
        // The Queue keeps its own line-up: these keys are the lists' (TV-U4).
        case "nest":
          if (!selectedTask || !canEdit || selection === "today") return;
          e.preventDefault();
          nestUnderAbove(selectedTask);
          return;
        case "unnest":
          if (!selectedTask || !canEdit || selection === "today") return;
          e.preventDefault();
          unnest(selectedTask);
          return;
        case "move-up":
        case "move-down":
          if (!selectedTask || !canEdit) return;
          e.preventDefault();
          if (selection === "today") moveInQueue(selectedTask, action === "move-up" ? -1 : 1);
          else moveInOrder(selectedTask, action === "move-up" ? -1 : 1);
          return;
      }
    },
    [
      editingId,
      reordering,
      move,
      selectedTask,
      canEdit,
      api,
      onRequestCapture,
      nest,
      nestedIds,
      expandedParents,
      toggleExpandParent,
      setSelectedId,
      selection,
      nestUnderAbove,
      unnest,
      moveInOrder,
      moveInQueue,
    ],
  );

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Row props, shared by the grouped and the reorderable (Queue) renders.
  const buildRowProps = useCallback(
    (t: Task) => ({
      task: t,
      bucketName: bucketNameById(t.bucketId),
      buckets,
      inboxId: inbox?.id ?? null,
      showBucket: showBucketTag,
      showAssignee,
      selected: t.id === selectedId,
      editing: t.id === editingId,
      command: command?.taskId === t.id ? command.kind : null,
      canEdit,
      onSelect: () => setSelectedId(t.id),
      onStartEdit: () => setEditingId(t.id),
      onEndEdit: () => {
        setEditingId(null);
        containerRef.current?.focus();
      },
      onClearCommand: () => {
        setCommand(null);
        // Back to the list, unless closing came from clicking into another field.
        const active = document.activeElement;
        const leftForElsewhere =
          active instanceof HTMLElement &&
          active !== document.body &&
          !containerRef.current?.contains(active) &&
          !active.closest('[data-slot="popover-content"]');
        if (!leftForElsewhere) containerRef.current?.focus();
      },
      onRequestCommand: (kind: RowCommand) => setCommand({ taskId: t.id, kind }),
      columns,
      api,
    }),
    [
      bucketNameById,
      buckets,
      inbox,
      showBucketTag,
      showAssignee,
      selectedId,
      editingId,
      command,
      canEdit,
      setSelectedId,
      columns,
      api,
    ],
  );

  // ── drag and drop (tasks-v2 §8, TV-U4) ──────────────────────────────────────
  // Every row is a drag source (the Queue keeps its own sortable below). The
  // List has no droppables: where a drop lands is resolved from the raw
  // pointer against the rows' boxes (drop-mode.ts) — left of the indent
  // reorders (insertion line), right of it nests (the row tints, a "Make
  // subtask" preview shows), a group header takes it into the group. The
  // rail and the hub are droppables of the page's one context; a drop on
  // them is the page's, so this list stands back.
  const canDrag = canEdit && selection !== "today";
  const [dragId, setDragId] = useState<string | null>(null);
  const [hover, setHover] = useState<ListDropHover | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  const hasChildren = useCallback(
    (id: string) => (api.subtasksByParent.get(id)?.length ?? 0) > 0,
    [api.subtasksByParent],
  );

  // Every row on screen, with what a drop needs to know about it.
  const rowIndex = useMemo(() => {
    const index = new Map<
      string,
      { task: Task; depth: 0 | 1; groupKey: string; lastChildId: string | null }
    >();
    for (const group of groups) {
      if (collapsed.has(group.key)) continue;
      for (const task of group.tasks) {
        const children =
          nest && expandedParents.has(task.id) ? (api.subtasksByParent.get(task.id) ?? []) : [];
        index.set(task.id, {
          task,
          depth: 0,
          groupKey: group.key,
          lastChildId: children[children.length - 1]?.id ?? null,
        });
        for (const child of children) {
          index.set(child.id, { task: child, depth: 1, groupKey: group.key, lastChildId: null });
        }
      }
    }
    return index;
  }, [groups, collapsed, nest, expandedParents, api.subtasksByParent]);

  const dragTask = dragId ? (taskById.get(dragId) ?? null) : null;

  // What's under (x, y) in this list: a row, a group header, `undefined`
  // inside a row's block but off its rows (the "Make subtask" preview, which
  // takes no pointer events — the hover stays), or null anywhere else (empty
  // space, outside the list): releasing there drops nothing.
  const targetAt = useCallback(
    (x: number, y: number): ListPointerTarget | null | undefined => {
      const container = containerRef.current;
      if (!container) return null;
      const stack = document.elementsFromPoint(x, y);
      if (!stack.some((el) => container.contains(el))) return null;
      for (const el of stack) {
        if (!container.contains(el)) continue;
        const rowEl = el.closest<HTMLElement>("[data-list-row]");
        if (rowEl && container.contains(rowEl)) {
          const info = rowIndex.get(rowEl.dataset.listRow ?? "");
          if (!info) return undefined;
          const r = rowEl.getBoundingClientRect();
          return { type: "row", ...info, rect: { left: r.left, top: r.top, height: r.height } };
        }
        const groupEl = el.closest<HTMLElement>("[data-list-group]");
        if (groupEl && container.contains(groupEl)) {
          return { type: "group", groupKey: groupEl.dataset.listGroup ?? "" };
        }
        const blockEl = el.closest("[data-list-block]");
        if (blockEl && container.contains(blockEl)) return undefined;
      }
      return null;
    },
    [rowIndex],
  );

  const hoverAt = useCallback(
    (x: number, y: number, previous: ListDropHover | null): ListDropHover | null => {
      if (!dragTask) return null;
      const over = targetAt(x, y);
      if (over === undefined) return previous;
      const next = resolveListHover({
        active: dragTask,
        activeNested: rowIndex.get(dragTask.id)?.depth === 1,
        activeGroupKey: groupKeyFor(dragTask, groupBy, nowOn(today)),
        hasChildren,
        pointer: { x, y },
        over,
        order: dragOrder,
        accepts: (key) => groupAccepts(groupBy, key, dragTask, { inboxId, assignableIds }),
        canNestInto: (parent) => canMoveInto(parent.bucketId, dragTask, inboxId),
      });
      // A drop "into the group" is drawn on the group's header; an ungrouped
      // list has none, so it would happen unseen (a subtask quietly coming out
      // of its parent in a sorted list): no drop. `<` still un-nests.
      return groupBy === "none" && next?.kind === "group" ? null : next;
    },
    [dragTask, targetAt, rowIndex, groupBy, today, hasChildren, dragOrder, inboxId, assignableIds],
  );

  // Track the raw pointer while dragging and re-resolve on every move and on
  // scroll (auto-scroll moves rows under a still pointer). The drop resolves
  // again from the same coordinates, never from dnd-kit's delta (gotchas/ui.md).
  useEffect(() => {
    if (!dragId) return;
    const update = () => {
      const p = pointerRef.current;
      if (!p) return;
      setHover((prev) => {
        const next = hoverAt(p.x, p.y, prev);
        return sameHover(prev, next) ? prev : next;
      });
    };
    const onMove = (e: PointerEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
      update();
    };
    document.addEventListener("pointermove", onMove, { capture: true });
    const container = containerRef.current;
    container?.addEventListener("scroll", update, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove, { capture: true });
      container?.removeEventListener("scroll", update);
    };
  }, [dragId, hoverAt]);

  const onListDragStart = useCallback(
    (e: DragStartEvent) => {
      const drag = asTaskDrag(e.active.data.current);
      if (drag?.from !== "list" || !rowIndex.has(drag.taskId)) return;
      setReordering(true); // the dnd sensor owns the arrows during a keyboard drag
      const start = e.activatorEvent;
      pointerRef.current =
        start instanceof PointerEvent || start instanceof MouseEvent
          ? { x: start.clientX, y: start.clientY }
          : null;
      setDragId(drag.taskId);
      setHover(null);
    },
    [rowIndex],
  );
  const endListDrag = useCallback(() => {
    setReordering(false);
    setDragId(null);
    setHover(null);
  }, []);

  // A plan becomes one write, saved in order (field-level, then status, then
  // assignee: never two writes to the row at once) with one Undo.
  const applyPlan = useCallback(
    (plan: ListDropPlan, active: Task) => {
      const parentId = plan.parentId;
      if (parentId && nest) setExpandedParents((prev) => new Set(prev).add(parentId));
      drop(writeFromPlan(plan), active);
    },
    [nest, drop],
  );

  const onListDragEnd = useCallback(
    (e: DragEndEvent) => {
      const id = dragId;
      const last = hover;
      endListDrag();
      if (!id || String(e.active.id) !== id) return;
      // The rail and the hub take their own drops (the page handles them).
      if (e.over && isSideDroppable(e.over.id)) return;
      const active = taskById.get(id);
      const p = pointerRef.current;
      if (!active || !p) return;
      const final = hoverAt(p.x, p.y, last);
      if (!final) return;
      // Dragging while sorted asks to switch back first (default m).
      if (final.kind === "sorted") {
        askManualOrder();
        return;
      }
      const plan = planListDrop({
        hover: final,
        active,
        activeGroupKey: groupKeyFor(active, groupBy, nowOn(today)),
        groupBy,
        allByPosition: api.tasks,
        groupTasks: (key) => groups.find((g) => g.key === key)?.all ?? [],
      });
      if (plan) applyPlan(plan, active);
    },
    [
      dragId,
      hover,
      endListDrag,
      taskById,
      hoverAt,
      askManualOrder,
      groupBy,
      today,
      api.tasks,
      groups,
      applyPlan,
    ],
  );

  // A row as the List renders it: the row, plus the drag marks it carries
  // (the insertion line or the sorted note on its edge).
  const renderRow = (task: Task, depth: 0 | 1, extra?: Partial<Parameters<typeof TaskRow>[0]>) => {
    const line =
      hover && (hover.kind === "reorder" || hover.kind === "sorted") && hover.line.id === task.id
        ? hover.line
        : null;
    const row = (drag?: {
      dragListeners: DraggableSyntheticListeners;
      dragActivatorRef: DragActivatorRef;
    }) => (
      <div data-list-row={task.id} className="relative">
        <TaskRow
          {...buildRowProps(task)}
          nested={depth === 1}
          parentTitle={depth === 0 ? parentTitleFor(task) : null}
          dragListeners={drag?.dragListeners}
          dragActivatorRef={drag?.dragActivatorRef}
          dropTarget={hover?.kind === "nest" && hover.targetId === task.id}
          {...extra}
        />
        {line && hover?.kind === "reorder" ? (
          <InsertionLine edge={line.edge} indent={hover.depth * NEST_INDENT_PX} />
        ) : null}
        {line && hover?.kind === "sorted" && order !== "manual" ? (
          // Above the list's very first row the scroll box would clip it.
          <SortedNote
            edge={
              line.edge === "top" && groupBy === "none" && task.id === visibleTasks[0]?.id
                ? "bottom"
                : line.edge
            }
          >
            {sortedByLabel(order)}
          </SortedNote>
        ) : null}
      </div>
    );
    if (!canDrag) return <div key={task.id}>{row()}</div>;
    return (
      <DraggableTask
        key={task.id}
        id={task.id}
        from="list"
        render={({ dragListeners, dragActivatorRef }) => row({ dragListeners, dragActivatorRef })}
      />
    );
  };

  // A top-level row plus (when expanded) its nested subtasks, and the "Make
  // subtask" preview under it while it's the nest target.
  const renderParentRow = (task: Task) => {
    const children = nest ? (api.subtasksByParent.get(task.id) ?? []) : [];
    const expanded = expandedParents.has(task.id);
    const nestHere = hover?.kind === "nest" && hover.targetId === task.id && dragTask;
    return (
      <div key={task.id} data-list-block>
        {renderRow(task, 0, {
          expandSlot,
          expandable: children.length > 0,
          expanded,
          onToggleExpand: () => toggleExpandParent(task.id),
        })}
        {expanded ? children.map((child) => renderRow(child, 1)) : null}
        {nestHere ? (
          <NestPreview indent={NEST_INDENT_PX}>{dragTask.title || "Untitled"}</NestPreview>
        ) : null}
      </div>
    );
  };

  // The Queue is a single flat, ordered group — reorder is a vertical sort over
  // it. Disabled (falls through to the grouped render) unless the parent asked
  // for it and the user can edit.
  const queueTasks = groups[0]?.tasks ?? [];
  const queueIds = useMemo(() => queueTasks.map((t) => t.id), [queueTasks]);
  const canReorder = reorderable && canEdit && groupBy === "none" && queueTasks.length > 1;
  const [queueDragId, setQueueDragId] = useState<string | null>(null);
  const queueDragTask = queueDragId ? (taskById.get(queueDragId) ?? null) : null;

  const onQueueDragEnd = useCallback(
    (e: DragEndEvent) => {
      setReordering(false);
      setQueueDragId(null);
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const from = queueIds.indexOf(String(active.id));
      const to = queueIds.indexOf(String(over.id));
      if (from < 0 || to < 0) return;
      reorderQueueWithUndo(queueIds, arrayMove(queueIds, from, to), "Moved");
    },
    [queueIds, reorderQueueWithUndo],
  );

  // Screen readers hear titles, never ids (standalone mounts; on the tasks
  // page the page's one context speaks for every surface).
  const announcements = useMemo(() => {
    const name = (id: string) => {
      const task = taskById.get(id);
      return task ? `“${task.title || "Untitled"}”` : null;
    };
    return taskDragAnnouncements({ taskName: (id) => name(id) ?? "the task", targetName: name });
  }, [taskById]);

  const overlayTask = dragTask ?? queueDragTask;
  const dragOverlay =
    typeof document !== "undefined"
      ? createPortal(
          // A List drag's preview sits beside the pointer, never over the row
          // it points at; the Queue's stays where it was grabbed (its
          // closestCenter measures the dragged rect).
          <DragOverlay modifiers={dragTask ? [overlayBesideCursor] : undefined}>
            {overlayTask ? (
              <DragOverlaySurface className={dragTask ? "w-64" : undefined}>
                <span className="min-w-0 flex-1 truncate">{overlayTask.title || "Untitled"}</span>
              </DragOverlaySurface>
            ) : null}
          </DragOverlay>,
          document.body,
        )
      : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PlanViewHeader
        title={scopeTitle}
        view={view}
        onViewChange={onViewChange}
        canEdit={canEdit}
        onRequestCapture={onRequestCapture}
        controls={header}
      />

      {/* list */}
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        // Chromium focuses a clicked button; after a mouse click on a row's
        // button, hand focus back to the list (as desktop WebKit does), so the
        // next Space/Enter acts on the selected row instead of re-clicking it.
        // Keyboard activation (detail 0), text fields and portaled popovers keep focus.
        onClickCapture={(e) => {
          if (e.detail === 0 || !e.currentTarget.contains(e.target as Node)) return;
          if (!(e.target instanceof Element) || !e.target.closest("button")) return;
          e.currentTarget.focus({ preventScroll: true });
        }}
        role="grid"
        aria-label={`${scopeTitle} tasks`}
        className="pane-scroll min-h-0 flex-1 overflow-auto rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {!api.loaded ? (
          <TaskListSkeleton />
        ) : tasks.length === 0 ? (
          filterActive ? (
            <TasksNoMatch onClearFilters={onClearFilters} />
          ) : (
            <TasksEmptyScope
              scopeTitle={scopeTitle}
              canEdit={canEdit}
              onRequestCapture={onRequestCapture}
            />
          )
        ) : canReorder ? (
          // Queue reorder. In external mode (DF-22) the tasks page owns the one
          // DndContext (so a row can be dropped on the hub or the rail); we bind
          // our reorder handlers through a monitor. The handlers stay spatially
          // disjoint — onQueueDragEnd early-returns when `over` isn't a queue row.
          <DndBoundary
            dndMode={dndMode}
            sensors={dndSensors}
            collisionDetection={closestCenter}
            onDragStart={(e) => {
              setReordering(true);
              setQueueDragId(String(e.active.id));
            }}
            onDragEnd={onQueueDragEnd}
            onDragCancel={() => {
              setReordering(false);
              setQueueDragId(null);
            }}
            announcements={announcements}
          >
            <SortableContext items={queueIds} strategy={verticalListSortingStrategy}>
              {queueTasks.map((task) => (
                <SortableTask
                  key={task.id}
                  id={task.id}
                  from="queue"
                  render={({ dragListeners, dragActivatorRef }) => (
                    <TaskRow
                      {...buildRowProps(task)}
                      parentTitle={parentTitleFor(task)}
                      dragListeners={dragListeners}
                      dragActivatorRef={dragActivatorRef}
                    />
                  )}
                />
              ))}
            </SortableContext>
            {dragOverlay}
          </DndBoundary>
        ) : (
          <MaybeDnd
            enabled={canDrag}
            dndMode={dndMode}
            sensors={dragSensors}
            onDragStart={onListDragStart}
            onDragEnd={onListDragEnd}
            onDragCancel={endListDrag}
            announcements={announcements}
          >
            {groups.map((group) => {
              const isCollapsed = collapsed.has(group.key);
              const groupTarget = hover?.kind === "group" && hover.groupKey === group.key;
              return (
                <div key={group.key} className="mb-1">
                  {groupBy !== "none" ? (
                    <button
                      type="button"
                      data-list-group={group.key}
                      onClick={() => toggleGroup(group.key)}
                      className={cn(
                        eyebrowVariants(),
                        "flex w-full items-center gap-1.5 rounded px-1 py-1 text-left hover:text-foreground",
                        groupTarget && DROP_TARGET,
                      )}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="size-3.5" aria-hidden />
                      ) : (
                        <ChevronDown className="size-3.5" aria-hidden />
                      )}
                      {group.label}
                      <span className="font-sans text-muted-foreground/70 tabular-nums">
                        {revealedGroups.has(group.key)
                          ? group.tasks.length
                          : group.tasks.length + group.hidden.length}
                      </span>
                    </button>
                  ) : null}

                  {!isCollapsed ? (
                    <>
                      {group.tasks.map((task) => renderParentRow(task))}
                      <CompletedLine
                        count={group.hidden.length}
                        shown={revealedGroups.has(group.key)}
                        onToggle={() => toggleRevealGroup(group.key)}
                      />
                    </>
                  ) : null}
                </div>
              );
            })}
            {canDrag ? dragOverlay : null}
          </MaybeDnd>
        )}
      </div>
    </div>
  );
}

/** Two hovers that draw the same thing (so a pointer move doesn't re-render). */
function sameHover(a: ListDropHover | null, b: ListDropHover | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The drag boundary when this list can drag; just the children when it can't. */
function MaybeDnd({
  enabled,
  dndMode,
  sensors,
  onDragStart,
  onDragEnd,
  onDragCancel,
  announcements,
  children,
}: {
  enabled: boolean;
  dndMode: "internal" | "external";
  sensors: ReturnType<typeof useTaskDndSensors>;
  onDragStart: (e: DragStartEvent) => void;
  onDragEnd: (e: DragEndEvent) => void;
  onDragCancel: () => void;
  announcements: Announcements;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <DndBoundary
      dndMode={dndMode}
      sensors={sensors}
      // The List has no droppables of its own (it resolves from the pointer);
      // on its own context this only ever finds nothing.
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
      announcements={announcements}
    >
      {children}
    </DndBoundary>
  );
}
