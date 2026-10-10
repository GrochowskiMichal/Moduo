import {
  closestCenter,
  type DragEndEvent,
  type DraggableSyntheticListeners,
  DragOverlay,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "../../../components/ui/button";
import { EmptyState as EmptyStateBase } from "../../../components/ui/empty-state";
import { GroupHeader } from "../../../components/ui/group-header";
import { Kbd } from "../../../components/ui/kbd";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { useAssignees } from "../assignees";
import { type CompletedMode, partitionCompleted } from "../completed";
import {
  canNestUnder,
  type GroupBy,
  groupsByBucket,
  groupTasks,
  isOpen,
  nestedSubtaskIds,
  showBucketPill,
} from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Bucket, Task } from "../model";
import { DEFAULT_ROW_PROPERTIES, rowColumns } from "../row-layout";
import {
  asTaskDropTarget,
  DndBoundary,
  type DragActivatorRef,
  NestableTask,
  pointerFirstCollision,
  SortableTask,
  useTaskDndSensors,
} from "./dnd/task-dnd";
import { listKeyActionFor } from "./list-keys";
import { type PlanView, PlanViewHeader } from "./plan-view-header";
import { CompletedLine } from "./task-meta";
import { type RowCommand, TaskRow } from "./task-row";

type Props = {
  tasks: Task[];
  scopeTitle: string;
  selection: string; // "all" | "mine" | "today" | "inbox" | bucketId
  view: PlanView;
  onViewChange: (view: PlanView) => void;
  groupBy: GroupBy;
  onGroupByChange: (next: GroupBy) => void;
  buckets: Bucket[];
  inbox: Bucket | null;
  bucketNameById: (id: string) => string;
  canEdit: boolean;
  onRequestCapture: () => void;
  /** Lifted task selection — drives the keyboard cursor and the detail rail. */
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  /** Tag-filter header control + active-chip row (built by the parent). */
  tagFilterControl?: ReactNode;
  activeTagFilters?: ReactNode;
  /** The Display menu (built by the parent). */
  displayControl?: ReactNode;
  /** Display → Completed (tasks-v2 §6). Default: hidden. The Queue ignores it. */
  completed?: CompletedMode;
  /** Display → "Show on rows". */
  properties?: readonly string[];
  /**
   * Tasks that stay listed whatever Display says, until the scope changes:
   * checked off here, or opened here (selected, deep-linked).
   */
  stayingIds?: ReadonlySet<string>;
  /** Enable drag-to-reorder (the Queue): a flat, ungrouped, ordered list. */
  reorderable?: boolean;
  /** Persist a reorder — receives the task ids in their new order. */
  onReorder?: (orderedIds: string[]) => void;
  /** Enable drag-a-task-onto-another → make it a subtask. Applies only to the
   * flat (`groupBy === "none"`) single-bucket list, never the cross-bucket "All"
   * or the Queue (which owns drag-to-reorder instead). */
  nestable?: boolean;
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

const GROUP_OPTIONS: Array<{ value: GroupBy; label: string }> = [
  { value: "none", label: "None" },
  { value: "status", label: "Status" },
  { value: "bucket", label: "Bucket" },
  { value: "priority", label: "Priority" },
  { value: "energy", label: "Energy" },
];

export function TaskListView({
  tasks,
  scopeTitle,
  selection,
  view,
  onViewChange,
  groupBy,
  onGroupByChange,
  buckets,
  inbox,
  bucketNameById,
  canEdit,
  onRequestCapture,
  selectedTaskId,
  onSelectTask,
  tagFilterControl,
  activeTagFilters,
  displayControl,
  completed = "hidden",
  properties = DEFAULT_ROW_PROPERTIES,
  stayingIds = NO_IDS,
  reorderable = false,
  onReorder,
  nestable = false,
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
  // The task currently being dragged onto another to nest it (null = not nesting).
  const [nestActiveId, setNestActiveId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dndSensors = useTaskDndSensors();
  // Nesting is drag-onto-target (no SortableContext) → default keyboard sensor.
  const nestSensors = useTaskDndSensors({ sortable: false });

  const showBucketTag = showBucketPill(selection, groupBy);
  // Grouping by bucket only makes sense across buckets (All, My tasks).
  const groupOptions = GROUP_OPTIONS.filter(
    (o) => o.value !== "bucket" || groupsByBucket(selection),
  );
  // In My tasks every row is mine, so rows leave the avatar out (D4-4).
  const showAssignee = selection !== "mine";

  // Subtasks nest under their parent (hidden from the top level) except in
  // Today — the commit queue is an ordered flat list, and subtasks are
  // individually committable. A subtask whose parent isn't in this scope
  // renders as a normal top-level row instead (never invisible).
  const nest = selection !== "today";
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
  const groups = useMemo(() => {
    const all = groupTasks(topLevelTasks, groupBy, { bucketName: bucketNameById });
    if (selection === "today") return all.map((g) => ({ ...g, hidden: [] as Task[] }));
    const now = new Date();
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
    return all.map((g) => {
      const { shown, hidden } = partitionCompleted(g.tasks, { mode: completed, now, keep });
      return { ...g, tasks: revealedGroups.has(g.key) ? g.tasks : shown, hidden };
    });
  }, [
    topLevelTasks,
    groupBy,
    bucketNameById,
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
  const groupSignature = `${selection}:${groupBy}:${groups.map((g) => g.key).join(",")}`;
  const initRef = useRef("");
  useEffect(() => {
    if (initRef.current === groupSignature) return;
    initRef.current = groupSignature;
    if (groupBy === "bucket" && groups.length > 1) {
      setCollapsed(new Set(groups.slice(1).map((g) => g.key)));
    } else {
      setCollapsed(new Set());
    }
    setExpandedParents(new Set());
    setRevealedGroups(NO_IDS);
  }, [groupSignature, groupBy, groups]);

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
  const { assignees } = useAssignees();
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
  const visibleTasks = useMemo(() => {
    const out: Task[] = [];
    for (const group of groups) {
      if (collapsed.has(group.key)) continue;
      for (const task of group.tasks) {
        out.push(task);
        if (expandedParents.has(task.id)) {
          out.push(...(api.subtasksByParent.get(task.id) ?? []));
        }
      }
    }
    return out;
  }, [groups, collapsed, expandedParents, api.subtasksByParent]);

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

  // A top-level row plus (when expanded) its nested subtasks — shared by the
  // grouped render and the drag-to-nest render. `drag` wires the whole-row drag
  // listeners and the live drop-target highlight when this list is in nestable mode.
  const renderParentRow = (
    task: Task,
    drag?: {
      dragListeners: DraggableSyntheticListeners;
      dragActivatorRef: DragActivatorRef;
      dropActive: boolean;
    },
  ) => {
    const children = nest ? (api.subtasksByParent.get(task.id) ?? []) : [];
    const expanded = expandedParents.has(task.id);
    return (
      <>
        <TaskRow
          {...buildRowProps(task)}
          expandSlot={expandSlot}
          expandable={children.length > 0}
          expanded={expanded}
          onToggleExpand={() => toggleExpandParent(task.id)}
          parentTitle={parentTitleFor(task)}
          dragListeners={drag?.dragListeners}
          dragActivatorRef={drag?.dragActivatorRef}
          dropActive={drag?.dropActive ?? false}
        />
        {expanded
          ? children.map((child) => <TaskRow key={child.id} {...buildRowProps(child)} nested />)
          : null}
      </>
    );
  };

  // The Queue is a single flat, ordered group — reorder is a vertical sort over
  // it. Disabled (falls through to the grouped render) unless the parent asked
  // for it and the user can edit.
  const queueTasks = groups[0]?.tasks ?? [];
  const queueIds = useMemo(() => queueTasks.map((t) => t.id), [queueTasks]);
  const canReorder = reorderable && canEdit && groupBy === "none" && queueTasks.length > 1;

  const onQueueDragEnd = useCallback(
    (e: DragEndEvent) => {
      setReordering(false);
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const from = queueIds.indexOf(String(active.id));
      const to = queueIds.indexOf(String(over.id));
      if (from < 0 || to < 0) return;
      onReorder?.(arrayMove(queueIds, from, to));
    },
    [queueIds, onReorder],
  );

  // ── drag-a-task-onto-another → subtask (nestable mode) ──────────────────────
  // The flat single-bucket list (groupBy "none", not the Queue, not cross-bucket
  // "All"). Top-level rows are drag sources + drop targets; children render
  // nested as usual. setTaskParent enforces the one-level rule (DB trigger backs it).
  const nestTasks = groups[0]?.tasks ?? [];
  const canNest =
    nestable &&
    canEdit &&
    groupBy === "none" &&
    !groupsByBucket(selection) &&
    selection !== "today" &&
    nestTasks.length > 1;

  const hasChildren = useCallback(
    (id: string) => (api.subtasksByParent.get(id)?.length ?? 0) > 0,
    [api.subtasksByParent],
  );
  // Only a childless task may be dragged — a parent can't itself become a subtask
  // (one level). Independent of the live drag, so it gates the grip at rest.
  const canDragRow = useCallback((task: Task) => !hasChildren(task.id), [hasChildren]);
  // A row accepts the active drag per the one-level eligibility rule (childless
  // active, top-level target, not a no-op) — shared with `setTaskParent`/the DB.
  const nestActiveTask = nestActiveId ? (taskById.get(nestActiveId) ?? null) : null;
  const isNestTarget = useCallback(
    (task: Task) => (nestActiveTask ? canNestUnder(nestActiveTask, task, hasChildren) : false),
    [nestActiveTask, hasChildren],
  );

  const onNestDragStart = useCallback((e: DragStartEvent) => {
    setReordering(true); // the dnd sensor owns the arrows during a keyboard drag
    setNestActiveId(String(e.active.id));
  }, []);
  const endNestDrag = useCallback(() => {
    setReordering(false);
    setNestActiveId(null);
  }, []);
  const onNestDragEnd = useCallback(
    (e: DragEndEvent) => {
      endNestDrag();
      const { active, over } = e;
      if (!over) return;
      const target = asTaskDropTarget(over.data.current);
      if (target?.type !== "onto-task") return;
      const childId = String(active.id);
      if (target.taskId === childId) return;
      // Now that this fires under the app-level context (DF-22), only act on a
      // drag that actually originated from this list's nest rows — a foreign
      // drag can't nest a stranger (belt to the `isNestTarget`/`canDrop` suspenders).
      if (!nestTasks.some((t) => t.id === childId)) return;
      api.setTaskParent(childId, target.taskId);
      // Reveal the result — expand the new parent so the moved task shows nested.
      if (nest) setExpandedParents((prev) => new Set(prev).add(target.taskId));
    },
    [endNestDrag, api, nest, nestTasks],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PlanViewHeader
        title={scopeTitle}
        view={view}
        onViewChange={onViewChange}
        canEdit={canEdit}
        onRequestCapture={onRequestCapture}
        filterControl={tagFilterControl}
        displayControl={displayControl}
        activeFilters={activeTagFilters}
        groupControl={
          <div className="flex items-center gap-1.5">
            <span className="font-sans text-xs text-muted-foreground">Group</span>
            <Select value={groupBy} onValueChange={(v) => onGroupByChange(v as GroupBy)}>
              <SelectTrigger size="sm" variant="ghost" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {groupOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
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
        {tasks.length === 0 ? (
          <EmptyState canEdit={canEdit} onRequestCapture={onRequestCapture} />
        ) : canReorder ? (
          // Queue reorder. In external mode (DF-22) the tasks page owns the one
          // DndContext (so a row can be dropped on the hub); we bind our reorder
          // handlers through a monitor. The handlers stay spatially disjoint —
          // onQueueDragEnd early-returns when `over` isn't a queue row.
          <DndBoundary
            dndMode={dndMode}
            sensors={dndSensors}
            collisionDetection={closestCenter}
            onDragStart={() => setReordering(true)}
            onDragEnd={onQueueDragEnd}
            onDragCancel={() => setReordering(false)}
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
          </DndBoundary>
        ) : canNest ? (
          // Drag-onto-task → subtask. Same external/internal split; onNestDragEnd
          // early-returns unless `over` is an `onto-task` droppable, so a drop on
          // the hub falls through to the page's link handler.
          <DndBoundary
            dndMode={dndMode}
            sensors={nestSensors}
            collisionDetection={pointerFirstCollision}
            onDragStart={onNestDragStart}
            onDragEnd={onNestDragEnd}
            onDragCancel={endNestDrag}
          >
            {nestTasks.map((task) => (
              <NestableTask
                key={task.id}
                id={task.id}
                from="list"
                canDrag={canDragRow(task)}
                canDrop={isNestTarget(task)}
                render={({ dragListeners, dragActivatorRef, isOver }) =>
                  renderParentRow(task, { dragListeners, dragActivatorRef, dropActive: isOver })
                }
              />
            ))}
            <CompletedLine
              count={groups[0]?.hidden.length ?? 0}
              shown={revealedGroups.has(groups[0]?.key ?? "")}
              onToggle={() => toggleRevealGroup(groups[0]?.key ?? "")}
            />
            {createPortal(
              <DragOverlay>
                {nestActiveTask ? (
                  <div className="pointer-events-none rounded-md border border-border bg-popover px-2 py-1 font-sans text-md shadow-md">
                    {nestActiveTask.title || "Untitled"}
                  </div>
                ) : null}
              </DragOverlay>,
              document.body,
            )}
          </DndBoundary>
        ) : (
          groups.map((group) => {
            const isCollapsed = collapsed.has(group.key);
            return (
              <div key={group.key} className="mb-1">
                {groupBy !== "none" ? (
                  // The group's name as typed (a bucket, a status): sentence
                  // case, never small caps (call 40).
                  <GroupHeader
                    label={group.label}
                    count={
                      revealedGroups.has(group.key)
                        ? group.tasks.length
                        : group.tasks.length + group.hidden.length
                    }
                    onToggle={() => toggleGroup(group.key)}
                    collapsed={isCollapsed}
                  />
                ) : null}

                {!isCollapsed ? (
                  <>
                    {group.tasks.map((task) => (
                      <div key={task.id}>{renderParentRow(task)}</div>
                    ))}
                    <CompletedLine
                      count={group.hidden.length}
                      shown={revealedGroups.has(group.key)}
                      onToggle={() => toggleRevealGroup(group.key)}
                    />
                  </>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function EmptyState({
  canEdit,
  onRequestCapture,
}: {
  canEdit: boolean;
  onRequestCapture: () => void;
}) {
  return (
    <EmptyStateBase
      title="Nothing here yet."
      action={
        canEdit ? (
          <Button variant="secondary" size="sm" onClick={onRequestCapture}>
            <Plus aria-hidden />
            Add a task
          </Button>
        ) : undefined
      }
      hint={
        canEdit ? (
          <>
            or press <Kbd>c</Kbd> to capture
          </>
        ) : undefined
      }
    />
  );
}
