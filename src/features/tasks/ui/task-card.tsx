import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CalendarDays,
  Clock,
  CornerDownRight,
  Inbox,
  ListChecks,
  Repeat,
} from "lucide-react";

import { Badge } from "../../../components/ui/badge";
import { TagChipList } from "../../../components/tag-chip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "../../../components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import { formatDue, formatScheduled, LEVEL_OPTIONS } from "../helpers";
import { isDrifted, type EnergyLevel, type PriorityLevel, type Task } from "../model";
import { recurrenceLabel } from "../parse/recurrence";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import { CompleteToggle } from "../../../components/ui/complete-toggle";
import { taskDrag } from "./dnd/task-dnd";
import { LevelDots } from "./level-icons";
import { BlockedMarker } from "./task-row";

type Props = {
  task: Task;
  bucketName: string;
  buckets: Array<{ id: string; name: string; isSystem: boolean }>;
  inboxId: string | null;
  /** Show the bucket tag (when columns are grouped by status, not bucket). */
  showBucket: boolean;
  canEdit: boolean;
  /** Selection drives the detail rail; available to view-only users too. */
  selected: boolean;
  onSelect: () => void;
  /** Click a tag chip to toggle it in the view filter. */
  onTagFilter?: (tagId: string) => void;
  api: TasksModuleApi;
};

/** A sortable kanban card. Drag reorders within a column; dropping on another
 *  column changes status (or bucket). */
export function TaskCard({
  task,
  bucketName,
  buckets,
  inboxId,
  showBucket,
  canEdit,
  selected,
  onSelect,
  onTagFilter,
  api,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: taskDrag(task.id, "board"),
    disabled: !canEdit,
  });

  const card = (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...(canEdit ? listeners : {})}
      role="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        // Linear-quiet: card = bg-card + hairline on the (transparent) column,
        // so it reads as a quiet lift off the canvas — not darker than its
        // column (the old bg-background was the inverted-elevation bug).
        "group flex items-start gap-2 rounded-md border px-2 py-1.5 text-sm transition-colors duration-(--motion-fade) ease-(--ease-out)",
        "select-none",
        selected
          ? "border-(--selected-border) bg-(--selected-bg)"
          : "border-border bg-card hover:border-foreground/30",
        // whole card is the drag handle (grip removed)
        canEdit && "cursor-grab active:cursor-grabbing",
        // hide the source while the DragOverlay clone follows the cursor; the
        // empty slot stays so neighbours animate apart (insertion indicator).
        isDragging && "opacity-0",
      )}
    >
      <CardBody
        task={task}
        bucketName={bucketName}
        inboxId={inboxId}
        showBucket={showBucket}
        canEdit={canEdit}
        onTagFilter={onTagFilter}
        api={api}
      />
    </div>
  );

  if (!canEdit) return card;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={() => api.toggleDone(task)}>
          {task.status === "done" ? "Mark not done" : "Mark done"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => api.toggleCommit(task.id)}>
          {task.committedFor === api.today ? "Remove from queue" : "Add to queue"}
        </ContextMenuItem>
        {task.recurrence && task.status !== "done" && task.status !== "archived" ? (
          <ContextMenuItem onSelect={() => api.skipOccurrence(task.id)}>
            Skip occurrence
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>Move to bucket</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              value={task.bucketId}
              onValueChange={(v) => {
                if (v !== task.bucketId) api.patchTask(task.id, { bucketId: v });
              }}
            >
              {inboxId ? <ContextMenuRadioItem value={inboxId}>Inbox</ContextMenuRadioItem> : null}
              {buckets
                .filter((b) => b.id !== inboxId)
                .map((b) => (
                  <ContextMenuRadioItem key={b.id} value={b.id}>
                    {b.name}
                  </ContextMenuRadioItem>
                ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Priority</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              value={task.priority ?? "none"}
              onValueChange={(v) =>
                api.patchTask(task.id, { priority: v === "none" ? null : (v as PriorityLevel) })
              }
            >
              <ContextMenuRadioItem value="none">None</ContextMenuRadioItem>
              {LEVEL_OPTIONS.map((l) => (
                <ContextMenuRadioItem key={l.value} value={l.value}>
                  {l.label}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Energy</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              value={task.energyLevel ?? "none"}
              onValueChange={(v) =>
                api.patchTask(task.id, { energyLevel: v === "none" ? null : (v as EnergyLevel) })
              }
            >
              <ContextMenuRadioItem value="none">None</ContextMenuRadioItem>
              {LEVEL_OPTIONS.map((l) => (
                <ContextMenuRadioItem key={l.value} value={l.value}>
                  {l.label}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => api.deleteTask(task.id)}>
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** The visible body — also rendered standalone inside the DragOverlay. */
export function CardBody({
  task,
  bucketName,
  inboxId,
  showBucket,
  canEdit,
  onTagFilter,
  api,
}: {
  task: Task;
  bucketName: string;
  inboxId: string | null;
  showBucket: boolean;
  canEdit: boolean;
  onTagFilter?: (tagId: string) => void;
  api: TasksModuleApi;
}) {
  const done = task.status === "done";
  const drifted = isDrifted(task);
  const committed = !!task.committedFor && task.committedFor === api.today;
  const scheduled = formatScheduled(task.scheduledAt);
  const due = formatDue(task.dueDate);
  const tags = api.tagsByTask.get(task.id) ?? [];
  // Blocked — computed, ambient: dim + a quiet icon, never red (spec §5c).
  const blocked = api.blockedTaskIds.has(task.id);
  // Quiet subtask mirrors: n/m progress on a parent; a parent caption on a
  // subtask card rendered flat (Today, or its parent is off this board).
  const progress = api.subtaskProgressByTask.get(task.id) ?? null;
  const parent = task.parentId ? api.tasks.find((t) => t.id === task.parentId) ?? null : null;
  const hasMeta =
    committed ||
    blocked ||
    task.recurrence ||
    scheduled ||
    due ||
    task.priority ||
    task.energyLevel ||
    tags.length > 0 ||
    (progress?.total ?? 0) > 0 ||
    !!parent;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <div className="flex items-start gap-2">
        <span className="mt-0.5" onPointerDown={(e) => e.stopPropagation()}>
          <CompleteToggle done={done} disabled={!canEdit} onToggle={() => api.toggleDone(task)} />
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 break-words font-display leading-snug",
            done ? "text-muted-foreground line-through" : blocked ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {task.title || "Untitled"}
        </span>
      </div>

      {hasMeta ? (
        <div className="flex flex-wrap items-center gap-1.5 pl-6 text-xs text-muted-foreground">
          {progress && progress.total > 0 ? (
            <span className="tabular-nums" aria-label={`${progress.done} of ${progress.total} subtasks done`}>
              {progress.done}/{progress.total}
            </span>
          ) : null}
          {parent ? (
            <span className="flex min-w-0 items-center gap-1">
              <CornerDownRight className="size-3 shrink-0 opacity-70" aria-hidden />
              <span className="truncate">{parent.title || "Untitled"}</span>
            </span>
          ) : null}
          {blocked ? <BlockedMarker taskId={task.id} api={api} /> : null}
          {/* Queue toggle — always visible + quiet (marker IS the action). */}
          {canEdit ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={committed ? "Remove from queue" : "Add to queue"}
                  aria-pressed={committed}
                  onClick={(e) => {
                    e.stopPropagation();
                    api.toggleCommit(task.id);
                  }}
                  className={cn(
                    "flex size-icon items-center justify-center rounded transition-colors duration-(--motion-fade) ease-(--ease-out)",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    committed ? "text-primary" : "text-muted-foreground/40 hover:text-foreground",
                  )}
                >
                  <ListChecks className="size-3.5" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent>{committed ? "Remove from queue" : "Add to queue"}</TooltipContent>
            </Tooltip>
          ) : committed ? (
            <span className="flex items-center text-primary" aria-label="Queued">
              <ListChecks className="size-3.5" aria-hidden />
            </span>
          ) : null}
          {task.recurrence ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center" aria-label="Recurring">
                  <Repeat className="size-3.5" aria-hidden />
                </span>
              </TooltipTrigger>
              <TooltipContent>{recurrenceLabel(task.recurrence)}</TooltipContent>
            </Tooltip>
          ) : null}
          {scheduled ? (
            <span className={cn("flex items-center gap-1", drifted && "text-foreground")}>
              <Clock className="size-3.5" aria-hidden />
              {scheduled}
            </span>
          ) : null}
          {due ? (
            <span className="flex items-center gap-1">
              <CalendarDays className="size-3.5" aria-hidden />
              {due}
            </span>
          ) : null}
          <LevelDots task={task} />
          {showBucket ? (
            <Badge variant="secondary" className="gap-1 font-normal">
              {task.bucketId === inboxId ? <Inbox className="size-3" aria-hidden /> : null}
              {bucketName}
            </Badge>
          ) : null}
          <TagChipList tags={tags} max={4} onTagClick={onTagFilter} />
        </div>
      ) : null}
    </div>
  );
}
