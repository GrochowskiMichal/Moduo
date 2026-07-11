import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  type DraggableSyntheticListeners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import { Button } from "../../../components/ui/button";
import { EmptyState as EmptyStateBase } from "../../../components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { canNestUnder, groupTasks, nestedSubtaskIds, type GroupBy } from "../helpers";
import type { Bucket, Task } from "../model";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import {
  NestableTask,
  SortableTask,
  asTaskDropTarget,
  pointerFirstCollision,
  useTaskDndSensors,
} from "./dnd/task-dnd";
import { PlanViewHeader, type PlanView } from "./plan-view-header";
import { Kbd } from "./task-detail-panel";
import { TaskRow, type RowCommand } from "./task-row";

type Props = {
  tasks: Task[];
  scopeTitle: string;
  selection: string; // "all" | "inbox" | bucketId
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
  /** Click a row's tag chip to toggle it in the filter. */
  onTagFilter?: (tagId: string) => void;
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
  api: TasksModuleApi;
};

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
  onTagFilter,
  reorderable = false,
  onReorder,
  nestable = false,
  revealRequest = null,
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

  const crossBucket = selection === "all" || selection === "today";
  const showBucketTag =
    crossBucket || groupBy === "status" || groupBy === "priority" || groupBy === "energy";
  // Grouping by bucket only makes sense across buckets (the "All" view).
  const groupOptions = GROUP_OPTIONS.filter((o) => o.value !== "bucket" || selection === "all");

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

  const groups = useMemo(
    () => groupTasks(topLevelTasks, groupBy, { bucketName: bucketNameById }),
    [topLevelTasks, groupBy, bucketNameById],
  );

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
  }, [groupSignature, groupBy, groups]);

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
          setExpandedParents((prev) =>
            prev.has(parentId) ? prev : new Set(prev).add(parentId),
          );
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
    (e: React.KeyboardEvent) => {
      // While inline-editing a title, the Input stops propagation; popovers are
      // portaled out — so reaching here means plain navigation is safe. During a
      // keyboard reorder the dnd sensor owns the arrows — don't also move the cursor.
      if (editingId || reordering) return;
      const key = e.key.toLowerCase();
      if (key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        move(1);
      } else if (key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        move(-1);
      } else if (key === "x" || e.key === " ") {
        if (!selectedTask || !canEdit) return;
        e.preventDefault();
        api.toggleDone(selectedTask);
      } else if (key === "enter" || key === "e") {
        if (!selectedTask || !canEdit) return;
        e.preventDefault();
        setEditingId(selectedTask.id);
      } else if (key === "c") {
        e.preventDefault();
        onRequestCapture();
      } else if (key === "b" && selectedTask && canEdit) {
        e.preventDefault();
        setCommand({ taskId: selectedTask.id, kind: "bucket" });
      } else if (key === "s" && selectedTask && canEdit) {
        e.preventDefault();
        setCommand({ taskId: selectedTask.id, kind: "schedule" });
      } else if (key === "d" && selectedTask && canEdit) {
        e.preventDefault();
        setCommand({ taskId: selectedTask.id, kind: "due" });
      } else if (key === "q" && selectedTask && canEdit) {
        // Queue/unqueue the selected task (Round D: `q` is the queue key — was
        // `t` from when the queue was "Today"; the rename makes `q` canonical).
        e.preventDefault();
        api.toggleCommit(selectedTask.id);
      } else if (e.key === "ArrowRight" && selectedTask) {
        // expand the selected parent's subtasks
        if ((api.subtasksByParent.get(selectedTask.id)?.length ?? 0) > 0 && nest) {
          e.preventDefault();
          setExpandedParents((prev) => new Set(prev).add(selectedTask.id));
        }
      } else if (e.key === "ArrowLeft" && selectedTask) {
        // collapse the selected parent — or jump from a subtask to its parent
        if (expandedParents.has(selectedTask.id)) {
          e.preventDefault();
          toggleExpandParent(selectedTask.id);
        } else if (selectedTask.parentId && nestedIds.has(selectedTask.id)) {
          e.preventDefault();
          setSelectedId(selectedTask.parentId);
        }
      } else if ((e.metaKey || e.ctrlKey) && (e.key === "Backspace" || e.key === "Delete")) {
        if (!selectedTask || !canEdit) return;
        e.preventDefault();
        api.deleteTask(selectedTask.id);
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
        containerRef.current?.focus();
      },
      onRequestCommand: (kind: RowCommand) => setCommand({ taskId: t.id, kind }),
      onTagFilter,
      api,
    }),
    [
      bucketNameById,
      buckets,
      inbox,
      showBucketTag,
      selectedId,
      editingId,
      command,
      canEdit,
      setSelectedId,
      onTagFilter,
      api,
    ],
  );

  // A top-level row plus (when expanded) its nested subtasks — shared by the
  // grouped render and the drag-to-nest render. `drag` wires the whole-row drag
  // listeners and the live drop-target highlight when this list is in nestable mode.
  const renderParentRow = (
    task: Task,
    drag?: { dragListeners: DraggableSyntheticListeners; dropActive: boolean },
  ) => {
    const children = nest ? api.subtasksByParent.get(task.id) ?? [] : [];
    const expanded = expandedParents.has(task.id);
    return (
      <>
        <TaskRow
          {...buildRowProps(task)}
          expandSlot={expandSlot}
          expandable={children.length > 0}
          expanded={expanded}
          onToggleExpand={() => toggleExpandParent(task.id)}
          progress={api.subtaskProgressByTask.get(task.id) ?? null}
          parentTitle={parentTitleFor(task)}
          dragListeners={drag?.dragListeners}
          dropActive={drag?.dropActive ?? false}
        />
        {expanded
          ? children.map((child) => (
              <TaskRow key={child.id} {...buildRowProps(child)} nested />
            ))
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
    selection !== "all" &&
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
  const nestActiveTask = nestActiveId ? taskById.get(nestActiveId) ?? null : null;
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
      api.setTaskParent(childId, target.taskId);
      // Reveal the result — expand the new parent so the moved task shows nested.
      if (nest) setExpandedParents((prev) => new Set(prev).add(target.taskId));
    },
    [endNestDrag, api, nest],
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
        role="grid"
        aria-label={`${scopeTitle} tasks`}
        className="min-h-0 flex-1 overflow-auto rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {tasks.length === 0 ? (
          <EmptyState canEdit={canEdit} onRequestCapture={onRequestCapture} />
        ) : canReorder ? (
          <DndContext
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
                  render={({ dragListeners }) => (
                    <TaskRow
                      {...buildRowProps(task)}
                      parentTitle={parentTitleFor(task)}
                      dragListeners={dragListeners}
                    />
                  )}
                />
              ))}
            </SortableContext>
          </DndContext>
        ) : canNest ? (
          <DndContext
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
                render={({ dragListeners, isOver }) =>
                  renderParentRow(task, { dragListeners, dropActive: isOver })
                }
              />
            ))}
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
          </DndContext>
        ) : (
          groups.map((group) => {
            const isCollapsed = collapsed.has(group.key);
            return (
              <div key={group.key} className="mb-1">
                {groupBy !== "none" ? (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left font-display text-2xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="size-3.5" aria-hidden />
                    ) : (
                      <ChevronDown className="size-3.5" aria-hidden />
                    )}
                    <span className="uppercase tracking-wide">{group.label}</span>
                    <span className="font-sans text-muted-foreground/70 tabular-nums">{group.tasks.length}</span>
                  </button>
                ) : null}

                {!isCollapsed
                  ? group.tasks.map((task) => <div key={task.id}>{renderParentRow(task)}</div>)
                  : null}
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
      hint={canEdit ? <>or press <Kbd>c</Kbd> to capture</> : undefined}
    />
  );
}
