import { useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { cn } from "../../../lib/utils";
import { endPosition, nestedSubtaskIds, STATUS_LABELS } from "../helpers";
import type { Bucket, Task, TaskStatus } from "../model";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { PlanView } from "./plan-view-header";
import { PlanViewHeader } from "./plan-view-header";
import { CardBody, TaskCard } from "./task-card";

export type BoardGroupBy = "status" | "bucket";

type Props = {
  tasks: Task[];
  scopeTitle: string;
  selection: string; // "all" | "inbox" | "today" | bucketId
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
  api,
}: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);

  // Columns by bucket only make sense across buckets ("All"); otherwise status.
  const groupDim: BoardGroupBy = selection === "all" ? boardGroupBy : "status";
  const showBucketTag = groupDim === "status" && (selection === "all" || selection === "today");

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const onDragStart = (e: DragStartEvent) => {
    if (!canEdit) return;
    setActiveId(String(e.active.id));
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    if (!canEdit || !e.over) return;
    const overId = String(e.over.id);
    if (!overId.startsWith("col:")) return;
    const task = tasks.find((t) => t.id === String(e.active.id));
    if (!task) return;
    const value = overId.slice(overId.lastIndexOf(":") + 1);

    if (groupDim === "status" && task.status !== value) {
      const dest = tasks.filter((t) => t.status === value);
      api.patchTask(task.id, { status: value as TaskStatus, position: endPosition(dest) });
    } else if (groupDim === "bucket" && task.bucketId !== value) {
      const dest = tasks.filter((t) => t.bucketId === value);
      api.patchTask(task.id, { bucketId: value, position: endPosition(dest) });
    }
  };

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) ?? null : null;

  const groupControl =
    selection === "all" ? (
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

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-1">
          {columns.map((col) => (
            <BoardColumn
              key={col.id}
              column={col}
              canEdit={canEdit}
              showBucketTag={showBucketTag}
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
              <DragOverlay dropAnimation={null}>
                {activeTask ? (
                  <div className="w-72 rounded-md border border-border bg-background px-2 py-1.5 shadow-lg">
                    <CardBody
                      task={activeTask}
                      bucketName={bucketNameById(activeTask.bucketId)}
                      inboxId={inbox?.id ?? null}
                      showBucket={showBucketTag}
                      canEdit={false}
                      api={api}
                    />
                  </div>
                ) : null}
              </DragOverlay>,
              document.body,
            )
          : null}
      </DndContext>
    </div>
  );
}

function BoardColumn({
  column,
  canEdit,
  showBucketTag,
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
        <span className="font-sans text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          {column.label}
        </span>
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
              canEdit={canEdit}
              selected={task.id === selectedTaskId}
              onSelect={() => onSelectTask(task.id)}
              onTagFilter={onTagFilter}
              api={api}
            />
          ))
        )}
      </div>
    </section>
  );
}
