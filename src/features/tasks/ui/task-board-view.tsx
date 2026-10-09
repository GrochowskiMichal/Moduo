import {
  closestCorners,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  useDroppable,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Eyebrow } from "../../../components/ui/eyebrow";
import { cn } from "../../../lib/utils";
import { type CompletedMode, partitionCompleted } from "../completed";
import { type BoardColumnsBy, orderTasks, type SubtaskMode, type TaskOrder } from "../display";
import {
  groupsByBucket,
  isOpen,
  nestedSubtaskIds,
  STATUS_LABELS,
  showBucketPill,
} from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Bucket, Task, TaskStatus } from "../model";
import { boardDropPosition } from "../reorder";
import { DEFAULT_ROW_PROPERTIES } from "../row-layout";
import { DndBoundary, useTaskDndSensors } from "./dnd/task-dnd";
import type { PlanHeaderControls, PlanView } from "./plan-view-header";
import { PlanViewHeader } from "./plan-view-header";
import { CardBody, TaskCard } from "./task-card";
import { CompletedLine } from "./task-meta";

export type BoardGroupBy = BoardColumnsBy;

const ORDER_NAMES: Record<Exclude<TaskOrder, "manual">, string> = {
  due: "due date",
  scheduled: "scheduled time",
  priority: "priority",
  created: "created",
  updated: "last updated",
};

type Props = {
  tasks: Task[];
  scopeTitle: string;
  selection: string; // "all" | "mine" | "inbox" | "today" | bucketId
  view: PlanView;
  onViewChange: (view: PlanView) => void;
  /** Display → Columns (Bucket only across buckets). */
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
  /** Display → Completed (tasks-v2 §6). Default: hidden. */
  completed?: CompletedMode;
  /** Display → "Show on rows" — cards follow it too. */
  properties?: readonly string[];
  /** Display → Order by, inside each column. */
  order?: TaskOrder;
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

// Reading order for status columns (left→right flow), distinct from the List's
// "open work first" order. Archived is never a board column (out of scope).
const BOARD_STATUS_ORDER: TaskStatus[] = ["todo", "in_progress", "done"];

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
  completed = "hidden",
  properties = DEFAULT_ROW_PROPERTIES,
  order = "manual",
  subtasks = "nested",
  stayingIds = NO_IDS,
  dndMode = "internal",
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

  // Columns by bucket only make sense across buckets (All, My tasks); otherwise status.
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
      (api.subtasksByParent.get(t.id) ?? []).some(isOpen);
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
    return BOARD_STATUS_ORDER.map((s) =>
      column(
        `col:status:${s}`,
        STATUS_LABELS[s],
        "status",
        s,
        boardTasks.filter((t) => t.status === s),
      ),
    );
  }, [
    groupDim,
    boardTasks,
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
    // completed ones included (TV-U1, boardDropPosition).
    const position = boardDropPosition({
      activeId,
      overId: overIsColumn ? null : overId,
      source: sourceCol.all,
      dest: destCol.all,
    });
    if (position === null) return;
    if (sourceCol.id === destCol.id) {
      // Under a sort the cards' order isn't theirs to change: a new position
      // would only move the task in Manual, out of sight.
      if (sorted) {
        toast(`Ordered by ${ORDER_NAMES[order as Exclude<TaskOrder, "manual">]}`, {
          description: "Set Display → Order by to Manual to reorder.",
        });
        return;
      }
      api.patchTask(activeId, { position });
      return;
    }
    // Across columns only the column's field changes under a sort; the
    // position is still worked out so Manual has a sensible place for it.
    const patch: Partial<Task> = { position };
    if (destCol.dim === "status") patch.status = destCol.value as TaskStatus;
    else patch.bucketId = destCol.value;
    api.patchTask(activeId, patch);
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
      >
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-1">
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
              api={api}
            />
          ))}
        </div>

        {typeof document !== "undefined"
          ? createPortal(
              <DragOverlay>
                {activeTask ? (
                  <div className="w-full rounded-lg border border-border bg-background px-3 py-2.5 shadow-lg">
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
                  </div>
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
  api: TasksModuleApi;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id, disabled: !canEdit });
  // While revealed, the column lists its completed cards too; the count in
  // the header is always every task in the column.
  const total = revealed ? column.tasks.length : column.tasks.length + column.hidden.length;

  return (
    // Columns flex between 280 and 400 px (tasks-v2 §6).
    <section className="flex h-full min-w-70 max-w-100 flex-1 flex-col">
      <header className="mb-2 flex items-center gap-1.5 px-1">
        <Eyebrow>{column.label}</Eyebrow>
        <span className="font-sans text-xs tabular-nums text-muted-foreground/70">{total}</span>
      </header>
      <div
        ref={setNodeRef}
        className={cn(
          // Linear-quiet: columns are transparent on the canvas; cards carry the
          // elevation (bg-card + hairline). Only a drag-over state lights up.
          "flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto rounded-md p-1 transition-colors duration-(--motion-fade) ease-(--ease-out)",
          isOver ? "bg-accent/40 ring-1 ring-ring/40" : "bg-transparent",
        )}
      >
        <SortableContext
          items={column.tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {column.tasks.length === 0 && column.hidden.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground/50">
              {canEdit ? "Drop tasks here" : "Empty"}
            </p>
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
