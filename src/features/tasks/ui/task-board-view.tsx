import {
  closestCorners,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  type SortingStrategy,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { DROP_TARGET, DragOverlaySurface } from "../../../components/ui/drag-visuals";
import { EmptyState } from "../../../components/ui/empty-state";
import { GroupHeader } from "../../../components/ui/group-header";
import { cn } from "../../../lib/utils";
import { type CompletedMode, partitionCompleted } from "../completed";
import { type BoardGroupBy, orderTasks, type SubtaskMode, type TaskOrder } from "../display";
import { boardColumnAccepts, planBoardDrop } from "../dnd/board-drop";
import { groupsByBucket, isUnfinished, nestedSubtaskIds, showBucketPill } from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Bucket, Task } from "../model";
import { BACK_TO_MANUAL_ORDER, dragOrderFor, sortedByLabel } from "../order";
import { DEFAULT_ROW_PROPERTIES } from "../row-layout";
import { STATUS_KEY_LABELS, type StatusKey, statusKeyOf } from "../statuses";
import { DndBoundary, taskDragAnnouncements, useTaskDndSensors } from "./dnd/task-dnd";
import type { PlanHeaderControls, PlanView } from "./plan-view-header";
import { PlanViewHeader } from "./plan-view-header";
import { CardBody, TaskCard } from "./task-card";
import { CompletedLine } from "./task-meta";
import { TaskBoardSkeleton, TasksNoMatch } from "./task-view-states";

export type { BoardGroupBy };

type Props = {
  tasks: Task[];
  scopeTitle: string;
  selection: string; // "all" | "mine" | "inbox" | "today" | bucketId
  view: PlanView;
  onViewChange: (view: PlanView) => void;
  /** Display → Group by (Project only across projects). */
  boardGroupBy: BoardGroupBy;
  buckets: Bucket[];
  inbox: Bucket | null;
  bucketNameById: (id: string) => string;
  canEdit: boolean;
  onRequestCapture: () => void;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  /** The toolbar's search, Filter, Display and count (built by the page). */
  header?: PlanHeaderControls;
  /** A filter is narrowing the scope: an empty result reads "No tasks match". */
  filterActive?: boolean;
  onClearFilters?: () => void;
  /** The statuses Filter → Status lets through (null: no Status filter). */
  statusFilter?: ReadonlySet<StatusKey> | null;
  /**
   * "+ Add status" at the end of one project's board grouped by status
   * (REPLAN 53a): opens that project's Statuses. Absent elsewhere.
   */
  onAddStatus?: () => void;
  /** Display → Completed (tasks-v2 §6). Default: hidden. */
  completed?: CompletedMode;
  /** Display → "Show on rows" — cards follow it too. */
  properties?: readonly string[];
  /** Display → Order by, inside each column. */
  order?: TaskOrder;
  /** Display → Order by back to Manual: the sorted drop toast's action. */
  onManualOrder?: () => void;
  /** Display → Subtasks: on their parent's card, or cards of their own. */
  subtasks?: SubtaskMode;
  /**
   * Tasks that stay listed whatever Display says, until the scope changes:
   * checked off here, or opened here (selected, deep-linked).
   */
  stayingIds?: ReadonlySet<string>;
  /** "external" = an ancestor owns the DndContext (DF-22: so a card can be
   * dragged onto the right-pane hub to link it); board move/reorder binds via a
   * monitor. Default "internal" (own DndContext) keeps standalone mounts working. */
  dndMode?: "internal" | "external";
  api: TasksModuleApi;
};

// Reading order for status groups (left→right flow), distinct from the List's
// "open work first" order. Won't do tasks are out of every scope until Filter →
// Status asks for them (or one is kept selected, TV-P0), so their group shows
// only then; a Status filter shows only the groups it lets through (TV-U2,
// AC1.4). Backlog comes first and shows only when the board has backlog tasks
// (TV-D9; the folded Backlog button is TV-U11's).
const BOARD_STATUS_ORDER: StatusKey[] = ["todo", "in_progress", "done"];
const ALL_BOARD_STATUSES: StatusKey[] = ["backlog", ...BOARD_STATUS_ORDER, "archived"];

type Column = {
  id: string;
  label: string;
  dim: BoardGroupBy;
  value: string;
  /** The cards the column lists. */
  tasks: Task[];
  /** Every task in the column, in order: drops are placed among these, so a
   * new position never collides with a hidden completed task's. */
  all: Task[];
  /** Completed tasks Display hides, behind the column's "N completed" line. */
  hidden: Task[];
};

const NO_IDS: ReadonlySet<string> = new Set();

/** Cards stay put while dragging where the board has no manual order (sorted,
 *  or across projects): parting them would promise a reorder the drop won't
 *  make. */
const NO_SHIFT: SortingStrategy = () => null;

export function TaskBoardView({
  tasks,
  scopeTitle,
  selection,
  view,
  onViewChange,
  boardGroupBy,
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
  statusFilter = null,
  completed = "hidden",
  properties = DEFAULT_ROW_PROPERTIES,
  order = "manual",
  onManualOrder,
  subtasks = "nested",
  stayingIds = NO_IDS,
  dndMode = "internal",
  onAddStatus,
  api,
}: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  // Columns whose hidden completed cards were asked for ("· show"); forgotten
  // when the scope changes (the set belongs to the scope it was made in).
  const [reveal, setReveal] = useState<{ scope: string; ids: ReadonlySet<string> }>({
    scope: selection,
    ids: NO_IDS,
  });
  const revealed = reveal.scope === selection ? reveal.ids : NO_IDS;

  // Grouping by project only makes sense across projects (All, My tasks); otherwise status.
  const groupDim: BoardGroupBy = groupsByBucket(selection) ? boardGroupBy : "status";
  const showBucketTag = showBucketPill(selection, groupDim);
  // In My tasks every card is mine, so cards leave the avatar out (D4-4).
  const showAssignee = selection !== "mine";

  // Subtasks whose parent is on this board stay off it — the parent card
  // carries the quiet n/m mirror and the detail panel lists them — unless
  // Display says Flat. The Queue stays flat (queued subtasks are first-class
  // queue items), and a subtask whose parent isn't on the board renders as a
  // normal card (never invisible). Cards follow Display → Order by.
  const nestedIds = useMemo(
    () => nestedSubtaskIds(tasks, selection !== "today" && subtasks === "nested"),
    [tasks, selection, subtasks],
  );
  const sorted = order !== "manual" && selection !== "today";
  const boardTasks = useMemo(() => {
    const top = nestedIds.size === 0 ? tasks : tasks.filter((t) => !nestedIds.has(t.id));
    return sorted ? orderTasks(top, order) : top;
  }, [tasks, nestedIds, sorted, order]);

  const columns = useMemo<Column[]>(() => {
    const now = new Date();
    // Kept even when done: staying (checked off or opened in this scope); the
    // selected card and its parent (a deep link or the panel must never point
    // at a card that isn't there); a parent with open subtasks (they live on
    // its card's n/m).
    const selectedParentId = selectedTaskId
      ? (api.tasks.find((t) => t.id === selectedTaskId)?.parentId ?? null)
      : null;
    const keep = (t: Task) =>
      stayingIds.has(t.id) ||
      t.id === selectedTaskId ||
      t.id === selectedParentId ||
      (api.subtasksByParent.get(t.id) ?? []).some(isUnfinished);
    const column = (id: string, label: string, dim: BoardGroupBy, value: string, all: Task[]) => {
      const { shown, hidden } = partitionCompleted(all, { mode: completed, now, keep });
      return { id, label, dim, value, tasks: revealed.has(id) ? all : shown, all, hidden };
    };
    if (groupDim === "bucket") {
      const ordered: Bucket[] = inbox ? [inbox, ...buckets] : buckets;
      return ordered.map((b) =>
        column(
          `col:bucket:${b.id}`,
          bucketNameById(b.id),
          "bucket",
          b.id,
          boardTasks.filter((t) => t.bucketId === b.id),
        ),
      );
    }
    const shown = statusFilter
      ? ALL_BOARD_STATUSES.filter((s) => statusFilter.has(s))
      : BOARD_STATUS_ORDER;
    // A card on the board always has its group (the kept Won't do task).
    const statuses = ALL_BOARD_STATUSES.filter(
      (s) => shown.includes(s) || boardTasks.some((t) => statusKeyOf(t) === s),
    );
    return statuses.map((s) =>
      column(
        `col:status:${s}`,
        STATUS_KEY_LABELS[s],
        "status",
        s,
        boardTasks.filter((t) => statusKeyOf(t) === s),
      ),
    );
  }, [
    groupDim,
    boardTasks,
    statusFilter,
    buckets,
    inbox,
    bucketNameById,
    completed,
    stayingIds,
    selectedTaskId,
    revealed,
    api.tasks,
    api.subtasksByParent,
  ]);

  const toggleReveal = (id: string) => {
    const next = new Set(revealed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setReveal({ scope: selection, ids: next });
  };

  const sensors = useTaskDndSensors();

  // Manual order lives inside one project (order.ts, default m): only a
  // project's or the Inbox's board, under Manual, takes a reorder.
  const dragOrder = dragOrderFor(selection, order);
  const askManualOrder = () => {
    if (order === "manual") return;
    toast(sortedByLabel(order), {
      action: onManualOrder ? { label: BACK_TO_MANUAL_ORDER, onClick: onManualOrder } : undefined,
    });
  };
  // Screen readers hear titles and column names, never ids (standalone
  // mounts; on the tasks page the page's one context speaks).
  const announcements = useMemo(() => {
    const cardName = (id: string) => {
      const task = tasks.find((t) => t.id === id);
      return task ? `“${task.title || "Untitled"}”` : null;
    };
    return taskDragAnnouncements({
      taskName: (id) => cardName(id) ?? "the task",
      targetName: (id) => columns.find((c) => c.id === id)?.label ?? cardName(id),
    });
  }, [tasks, columns]);

  const onDragStart = (e: DragStartEvent) => {
    if (!canEdit) return;
    setActiveId(String(e.active.id));
  };

  // Resolve a drop into a `position` (Lexorank slot) plus the column field that
  // changed — reorder within a column, or move (status/bucket) across columns.
  // Everything is computed on drop from the over target (a sibling card, or the
  // column itself for an end-drop); within-column shifts animate via the
  // SortableContext (no fragile mid-drag cross-container state).
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!canEdit || !over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const task = tasks.find((t) => t.id === activeId);
    const sourceCol = columns.find((c) => c.tasks.some((t) => t.id === activeId));
    const overIsColumn = overId.startsWith("col:");
    const destCol = overIsColumn
      ? columns.find((c) => c.id === overId)
      : columns.find((c) => c.tasks.some((t) => t.id === overId));
    if (!task || !sourceCol || !destCol) return;

    // Positions are worked out among EVERY task in the column, hidden
    // completed ones included (TV-U1), and only where the board is one
    // project's manual order (board-drop.ts, default m).
    const decision = planBoardDrop({
      task,
      parent: task.parentId ? (api.tasks.find((t) => t.id === task.parentId) ?? null) : null,
      source: sourceCol,
      dest: destCol,
      overId: overIsColumn ? null : overId,
      order: dragOrder,
      inboxId: inbox?.id ?? null,
      bucketName: bucketNameById,
    });
    if (decision.kind === "ask-manual") askManualOrder();
    else if (decision.kind === "write") void api.dropTask(decision.write, decision.label);
  };

  const activeTask = activeId ? (tasks.find((t) => t.id === activeId) ?? null) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PlanViewHeader
        title={scopeTitle}
        view={view}
        onViewChange={onViewChange}
        controls={header}
        canEdit={canEdit}
        onRequestCapture={onRequestCapture}
      />

      {/* One boundary: a self-owned context ("internal") or a monitor bound to
          the tasks page's app-level context ("external", DF-22 — so a card can
          be dropped on the right-pane hub). onDragEnd early-returns unless the
          drop resolves to a board column/card, so a hub drop falls through to
          the page's link handler. */}
      <DndBoundary
        dndMode={dndMode}
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
        announcements={announcements}
      >
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-1">
          {!api.loaded ? (
            <TaskBoardSkeleton />
          ) : filterActive && tasks.length === 0 ? (
            <TasksNoMatch onClearFilters={onClearFilters} />
          ) : (
            <>
              {columns.map((col) => (
                <BoardColumn
                  key={col.id}
                  column={col}
                  canEdit={canEdit}
                  showBucketTag={showBucketTag}
                  showAssignee={showAssignee}
                  properties={properties}
                  buckets={buckets}
                  inbox={inbox}
                  bucketNameById={bucketNameById}
                  selectedTaskId={selectedTaskId}
                  onSelectTask={onSelectTask}
                  revealed={revealed.has(col.id)}
                  onToggleReveal={() => toggleReveal(col.id)}
                  activeTask={activeTask}
                  reorderable={dragOrder === "manual"}
                  api={api}
                />
              ))}
              {canEdit && onAddStatus && groupDim === "status" ? (
                <div className="shrink-0 pt-0.5">
                  <Button variant="ghost" size="sm" onClick={onAddStatus}>
                    <Plus aria-hidden />
                    Add status
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>

        {typeof document !== "undefined"
          ? createPortal(
              <DragOverlay>
                {activeTask ? (
                  // DS-4's overlay surface, card-shaped (U4-5: one drag look).
                  <DragOverlaySurface className="w-full items-start rounded-lg px-3 py-2.5 text-sm">
                    <CardBody
                      task={activeTask}
                      bucketName={bucketNameById(activeTask.bucketId)}
                      inboxId={inbox?.id ?? null}
                      showBucket={showBucketTag}
                      showAssignee={showAssignee}
                      properties={properties}
                      canEdit={false}
                      api={api}
                    />
                  </DragOverlaySurface>
                ) : null}
              </DragOverlay>,
              document.body,
            )
          : null}
      </DndBoundary>
    </div>
  );
}

function BoardColumn({
  column,
  canEdit,
  showBucketTag,
  showAssignee,
  properties,
  buckets,
  inbox,
  bucketNameById,
  selectedTaskId,
  onSelectTask,
  revealed,
  onToggleReveal,
  activeTask,
  reorderable,
  api,
}: {
  column: Column;
  canEdit: boolean;
  showBucketTag: boolean;
  showAssignee: boolean;
  properties: readonly string[];
  buckets: Bucket[];
  inbox: Bucket | null;
  bucketNameById: (id: string) => string;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  revealed: boolean;
  onToggleReveal: () => void;
  /** The card being dragged, if any. */
  activeTask: Task | null;
  /** The board is one project's manual order: cards part to make room. */
  reorderable: boolean;
  api: TasksModuleApi;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id, disabled: !canEdit });
  // Only a column that would take the card lights up (never the Inbox for a
  // project's task).
  const accepting =
    isOver && (!activeTask || boardColumnAccepts(column, activeTask, inbox?.id ?? null));
  // While revealed, the column lists its completed cards too; the count in
  // the header is always every task in the column.
  const total = revealed ? column.tasks.length : column.tasks.length + column.hidden.length;

  return (
    // Columns flex between 280 and 400 px (tasks-v2 §6).
    <section className="flex h-full min-w-70 max-w-100 flex-1 flex-col">
      {/* The column's name as typed (a bucket, a status): sentence case (call 40). */}
      <header className="mb-2">
        <GroupHeader label={column.label} count={total} />
      </header>
      <div
        ref={setNodeRef}
        className={cn(
          // Linear-quiet: columns are transparent on the canvas; cards carry the
          // elevation (bg-card + hairline). Only a drag-over state lights up.
          "flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto rounded-md p-1 transition-colors duration-(--motion-fade) ease-(--ease-out)",
          accepting ? DROP_TARGET : "bg-transparent",
        )}
      >
        <SortableContext
          items={column.tasks.map((t) => t.id)}
          strategy={reorderable ? verticalListSortingStrategy : NO_SHIFT}
        >
          {column.tasks.length === 0 && column.hidden.length === 0 ? (
            <EmptyState size="inline" title={canEdit ? "Drop tasks here" : "Empty"} />
          ) : (
            column.tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                bucketName={bucketNameById(task.bucketId)}
                buckets={buckets}
                inboxId={inbox?.id ?? null}
                showBucket={showBucketTag}
                showAssignee={showAssignee}
                properties={properties}
                canEdit={canEdit}
                selected={task.id === selectedTaskId}
                onSelect={() => onSelectTask(task.id)}
                api={api}
              />
            ))
          )}
        </SortableContext>
        <CompletedLine
          count={column.hidden.length}
          shown={revealed}
          onToggle={onToggleReveal}
          className="px-1"
        />
      </div>
    </section>
  );
}
