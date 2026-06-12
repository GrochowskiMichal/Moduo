import { useDraggable } from "@dnd-kit/core";
import { CalendarDays, Clock, GripVertical, Inbox, Repeat, Sunrise } from "lucide-react";

import { Badge } from "../../../components/ui/badge";
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
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import { CompleteToggle, LevelDots } from "./task-row";

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
  api: TasksModuleApi;
};

/** A draggable kanban card. Cross-column drag changes status (or bucket). */
export function TaskCard({
  task,
  bucketName,
  buckets,
  inboxId,
  showBucket,
  canEdit,
  selected,
  onSelect,
  api,
}: Props) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { type: "card", taskId: task.id, bucketId: task.bucketId, status: task.status },
    disabled: !canEdit,
  });

  const card = (
    <div
      ref={setNodeRef}
      {...attributes}
      {...(canEdit ? listeners : {})}
      role="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "group flex items-start gap-2 rounded-md border px-2 py-1.5 text-sm transition-colors",
        "select-none",
        selected ? "border-ring bg-accent" : "border-border bg-background hover:border-foreground/30",
        canEdit && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40",
      )}
    >
      {canEdit ? (
        <GripVertical
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
      ) : null}
      <CardBody
        task={task}
        bucketName={bucketName}
        inboxId={inboxId}
        showBucket={showBucket}
        canEdit={canEdit}
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
          {task.committedFor === api.today ? "Remove from today" : "Commit to today"}
        </ContextMenuItem>
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
  api,
}: {
  task: Task;
  bucketName: string;
  inboxId: string | null;
  showBucket: boolean;
  canEdit: boolean;
  api: TasksModuleApi;
}) {
  const done = task.status === "done";
  const drifted = isDrifted(task);
  const committed = !!task.committedFor && task.committedFor === api.today;
  const scheduled = formatScheduled(task.scheduledAt);
  const due = formatDue(task.dueDate);
  const hasMeta = committed || task.recurrence || scheduled || due || task.priority || task.energyLevel;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <div className="flex items-start gap-2">
        <span className="mt-0.5" onPointerDown={(e) => e.stopPropagation()}>
          <CompleteToggle done={done} disabled={!canEdit} onToggle={() => api.toggleDone(task)} />
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 break-words font-display leading-snug",
            done ? "text-muted-foreground line-through" : "text-foreground",
          )}
        >
          {task.title || "Untitled"}
        </span>
      </div>

      {hasMeta ? (
        <div className="flex flex-wrap items-center gap-1.5 pl-6 text-xs text-muted-foreground">
          {committed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center text-foreground" aria-label="Committed for today">
                  <Sunrise className="size-3.5" aria-hidden />
                </span>
              </TooltipTrigger>
              <TooltipContent>Committed for today</TooltipContent>
            </Tooltip>
          ) : null}
          {task.recurrence ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center" aria-label="Recurring">
                  <Repeat className="size-3.5" aria-hidden />
                </span>
              </TooltipTrigger>
              <TooltipContent>{task.recurrence.rrule}</TooltipContent>
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
        </div>
      ) : null}
    </div>
  );
}
