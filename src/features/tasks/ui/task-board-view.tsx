import {
  closestCorners,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  useDroppable,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { type ReactNode, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Eyebrow } from "../../../components/ui/eyebrow";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { cn } from "../../../lib/utils";
import { groupsByBucket, nestedSubtaskIds, STATUS_LABELS, showBucketPill } from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Bucket, Task, TaskStatus } from "../model";
import { positionForReorder } from "../reorder";
import { DndBoundary, useTaskDndSensors } from "./dnd/task-dnd";
import type { PlanView } from "./plan-view-header";
import { PlanViewHeader } from "./plan-view-header";
import { CardBody, TaskCard } from "./task-card";

export type BoardGroupBy = "status" | "bucket";

type Props = {
  tasks: Task[];
  scopeTitle: string;
  selection: string; // "all" | "mine" | "inbox" | "today" | bucketId
  view: PlanView;
  onViewChange: (view: PlanView) => void;
  boardGroupBy: BoardGroupBy;
  onBoardGroupByChange: (next: BoardGroupBy) => void;
  buckets: Bucket[];
  inbox: Bucket | null;
  bucketNameById: (id: string) => string;
  canEdit: boolean;
  onRequestCapture: () => void;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  tagFilterControl?: ReactNode;
  activeTagFilters?: ReactNode;
  onTagFilter?: (tagId: string) => void;
  /** "external" = an ancestor owns the DndContext (DF-22: so a card can be
   * dragged onto the right-pane hub to link it); board move/reorder binds via a
   * monitor. Default "internal" (own DndContext) keeps standalone mounts working. */
  dndMode?: "internal" | "external";
  api: TasksModuleApi;
};

// Reading order for status columns (left→right flow), distinct from the List's
// "open work first" order. Archived is never a board column (out of scope).
const BOARD_STATUS_ORDER: TaskStatus[] = ["todo", "in_progress", "done"];

type Column = { id: string; label: string; dim: BoardGroupBy; value: string; tasks: Task[] };

export function TaskBoardView({
  tasks,
  scopeTitle,
  selection,
  view,
  onViewChange,
  boardGroupBy,
  onBoardGroupByChange,
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
  dndMode = "internal",
  api,
}: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);

  // Columns by bucket only make sense across buckets (All, My tasks); otherwise status.
  const groupDim: BoardGroupBy = groupsByBucket(selection) ? boardGroupBy : "status";
  const showBucketTag = showBucketPill(selection, groupDim);
  // In My tasks every card is mine, so cards leave the avatar out (D4-4).
  const showAssignee = selection !== "mine";

  // Subtasks whose parent is on this board stay off it — the parent card
  // carries the quiet n/m mirror and the detail panel lists them. Today stays
  // flat (committed subtasks are first-class queue items), and a subtask whose
  // parent isn't on the board renders as a normal card (never invisible).
  const nestedIds = useMemo(
    () => nestedSubtaskIds(tasks, selection !== "today"),
    [tasks, selection],
  );
  const boardTasks = useMemo(
    () => (nestedIds.size === 0 ? tasks : tasks.filter((t) => !nestedIds.has(t.id))),
    [tasks, nestedIds],
  );

  const columns = useMemo<Column[]>(() => {
    if (groupDim === "bucket") {
      const ordered: Bucket[] = inbox ? [inbox, ...buckets] : buckets;
      return ordered.map((b) => ({
        id: `col:bucket:${b.id}`,
        label: bucketNameById(b.id),
        dim: "bucket" as const,
        value: b.id,
        tasks: boardTasks.filter((t) => t.bucketId === b.id),
      }));
    }
    return BOARD_STATUS_ORDER.map((s) => ({
      id: `col:status:${s}`,
      label: STATUS_LABELS[s],
      dim: "status" as const,
      value: s,
      tasks: boardTasks.filter((t) => t.status === s),
    }));
  }, [groupDim, boardTasks, buckets, inbox, bucketNameById]);

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

    if (sourceCol.id === destCol.id) {
      // within-column reorder
      if (overIsColumn) return; // dropped on own column gutter — no move
      const ids = sourceCol.tasks.map((t) => t.id);
      const from = ids.indexOf(activeId);
      const to = ids.indexOf(overId);
      if (from < 0 || to < 0 || from === to) return;
      const reordered = arrayMove(sourceCol.tasks, from, to);
      api.patchTask(activeId, { position: positionForReorder(reordered, to) });
      return;
    }

    // cross-column move — insert before the hovered card, or at the column end
    const destTasks = destCol.tasks; // excludes the active card (other column)
    const overIdx = overIsColumn ? destTasks.length : destTasks.findIndex((t) => t.id === overId);
    const at = Math.max(0, Math.min(destTasks.length, overIdx < 0 ? destTasks.length : overIdx));
    const ordered = [...destTasks.slice(0, at), task, ...destTasks.slice(at)];
    const patch: Partial<Task> = { position: positionForReorder(ordered, at) };
    if (destCol.dim === "status") patch.status = destCol.value as TaskStatus;
    else patch.bucketId = destCol.value;
    api.patchTask(activeId, patch);
  };

  const activeTask = activeId ? (tasks.find((t) => t.id === activeId) ?? null) : null;

  const groupControl = groupsByBucket(selection) ? (
    <div className="flex items-center gap-1.5">
      <span className="font-sans text-xs text-muted-foreground">Columns</span>
      <Select value={boardGroupBy} onValueChange={(v) => onBoardGroupByChange(v as BoardGroupBy)}>
        <SelectTrigger size="sm" variant="ghost" className="w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="status">Status</SelectItem>
          <SelectItem value="bucket">Bucket</SelectItem>
        </SelectContent>
      </Select>
    </div>
  ) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PlanViewHeader
        title={scopeTitle}
        view={view}
        onViewChange={onViewChange}
        groupControl={groupControl}
        filterControl={tagFilterControl}
        activeFilters={activeTagFilters}
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
              buckets={buckets}
              inbox={inbox}
              bucketNameById={bucketNameById}
              selectedTaskId={selectedTaskId}
              onSelectTask={onSelectTask}
              onTagFilter={onTagFilter}
              api={api}
            />
          ))}
        </div>

        {typeof document !== "undefined"
          ? createPortal(
              <DragOverlay>
                {activeTask ? (
                  <div className="w-72 rounded-md border border-border bg-background px-2 py-1.5 shadow-lg">
                    <CardBody
                      task={activeTask}
                      bucketName={bucketNameById(activeTask.bucketId)}
                      inboxId={inbox?.id ?? null}
                      showBucket={showBucketTag}
                      showAssignee={showAssignee}
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
  buckets,
  inbox,
  bucketNameById,
  selectedTaskId,
  onSelectTask,
  onTagFilter,
  api,
}: {
  column: Column;
  canEdit: boolean;
  showBucketTag: boolean;
  showAssignee: boolean;
  buckets: Bucket[];
  inbox: Bucket | null;
  bucketNameById: (id: string) => string;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  onTagFilter?: (tagId: string) => void;
  api: TasksModuleApi;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id, disabled: !canEdit });

  return (
    <section className="flex h-full w-72 shrink-0 flex-col">
      <header className="mb-2 flex items-center gap-1.5 px-1">
        <Eyebrow>{column.label}</Eyebrow>
        <span className="font-sans text-xs tabular-nums text-muted-foreground/70">
          {column.tasks.length}
        </span>
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
          {column.tasks.length === 0 ? (
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
                canEdit={canEdit}
                selected={task.id === selectedTaskId}
                onSelect={() => onSelectTask(task.id)}
                onTagFilter={onTagFilter}
                api={api}
              />
            ))
          )}
        </SortableContext>
      </div>
    </section>
  );
}
