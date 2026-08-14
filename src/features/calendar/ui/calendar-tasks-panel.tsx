// The right panel's Tasks view — the drag source (DESIGN_BRIEF §5, AC11):
// Today · Due soon · Backlog groups + search; rows drag onto the grid via the
// universal drag contract (the legacy TaskDragData payload, adapted by
// asDragPayload); the checkbox completes with the same op as everywhere.
// Already-scheduled rows show their time and sink to the bottom of their
// group — visibility beats purity.
//
// CAL-4 adds the Review sub-state (AC9): when the strip's "Review" is active a
// curation section pins to the top — untick to exclude, "Move N to today",
// rows drag onto the grid, per-row Remove. The normal groups stay below.

import { useDraggable } from "@dnd-kit/core";
import { CalendarCheck, GripVertical, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "../../../components/ui/button";
import { CompleteToggle } from "../../../components/ui/complete-toggle";
import { Eyebrow } from "../../../components/ui/eyebrow";
import { IconButton } from "../../../components/ui/icon-button";
import { Input } from "../../../components/ui/input";
import { formatDue, formatScheduled } from "../../tasks/helpers";
import type { TasksModuleApi } from "../../tasks/hooks/use-tasks-module";
import type { Task } from "../../tasks/model";
import { taskDrag } from "../../tasks/ui/dnd/task-dnd";
import { groupPanelTasks } from "../panel";
import type { StripItem } from "../strip";
import { formatDayLabel, formatTimeOfDay } from "./time-format";

export type ReviewController = {
  items: StripItem[];
  onMove: (taskIds: string[]) => void;
  onRemove: (taskId: string) => void;
  onClose: () => void;
};

type Props = {
  api: TasksModuleApi;
  onOpenTask: (taskId: string) => void;
  onRequestCapture: () => void;
  /** The strip's Review sub-state (AC9). Null when not reviewing. */
  review?: ReviewController | null;
};

export function CalendarTasksPanel({ api, onOpenTask, onRequestCapture, review }: Props) {
  const [query, setQuery] = useState("");
  const groups = useMemo(
    () =>
      groupPanelTasks({
        tasks: api.tasks,
        committedTasks: api.committedTasks,
        query,
      }),
    [api.tasks, api.committedTasks, query],
  );

  const total = groups.today.length + groups.dueSoon.length + groups.backlog.length;

  return (
    <div className="scrollbar-thin flex h-full min-h-0 flex-col gap-2 overflow-y-auto">
      {review && review.items.length > 0 ? (
        <ReviewSection review={review} canEdit={api.canEdit} />
      ) : null}

      <div className="relative shrink-0">
        <Search
          aria-hidden
          className="absolute left-2 top-1/2 size-icon-xs -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tasks"
          aria-label="Search tasks"
          className="pl-6.5"
          style={{ height: "var(--ctrl-h-sm)" }}
        />
      </div>

      {total === 0 && !groups.emptyBySearch ? (
        <div className="flex flex-col items-start gap-2 px-1 py-3">
          <span className="text-sm text-muted-foreground">
            Nothing to schedule — capture a task or enjoy the calm.
          </span>
          <Button variant="outline" size="sm" onClick={onRequestCapture}>
            Capture
          </Button>
        </div>
      ) : null}
      {groups.emptyBySearch ? (
        <span className="px-1 py-3 text-sm text-muted-foreground">
          Nothing matches "{query.trim()}".
        </span>
      ) : null}

      <TaskGroup title="Today" tasks={groups.today} api={api} onOpenTask={onOpenTask} />
      <TaskGroup title="Due soon" tasks={groups.dueSoon} api={api} onOpenTask={onOpenTask} />
      <TaskGroup title="Backlog" tasks={groups.backlog} api={api} onOpenTask={onOpenTask} />
    </div>
  );
}

// ── Review sub-state (the strip's curate-then-move path) ─────────────────────

function ReviewSection({ review, canEdit }: { review: ReviewController; canEdit: boolean }) {
  // Excluded ids (unticked). Default: everything included.
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  const includedIds = review.items.map((i) => i.taskId).filter((id) => !excluded.has(id));

  return (
    <div className="shrink-0 rounded-lg border border-border bg-card/40 p-2">
      <div className="flex items-center gap-2 px-1">
        <Eyebrow className="min-w-0 flex-1">
          Unfinished from earlier ({review.items.length})
        </Eyebrow>
        <IconButton icon={X} label="Close review" onClick={review.onClose} />
      </div>

      <div className="mt-1 flex flex-col gap-0.5">
        {review.items.map((item) => (
          <ReviewRow
            key={item.taskId}
            item={item}
            canEdit={canEdit}
            included={!excluded.has(item.taskId)}
            onToggleInclude={() =>
              setExcluded((prev) => {
                const next = new Set(prev);
                if (next.has(item.taskId)) next.delete(item.taskId);
                else next.add(item.taskId);
                return next;
              })
            }
            onRemove={() => review.onRemove(item.taskId)}
          />
        ))}
      </div>

      {canEdit ? (
        <div className="mt-2 flex px-1">
          <Button
            size="sm"
            variant="secondary"
            disabled={includedIds.length === 0}
            onClick={() => review.onMove(includedIds)}
          >
            Move {includedIds.length} to today
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ReviewRow({
  item,
  canEdit,
  included,
  onToggleInclude,
  onRemove,
}: {
  item: StripItem;
  canEdit: boolean;
  included: boolean;
  onToggleInclude: () => void;
  onRemove: () => void;
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `cal-review-task:${item.taskId}`,
    data: taskDrag(item.taskId, "list"),
    disabled: !canEdit,
  });
  const origin = `${formatDayLabel(item.scheduledAtMs)} · ${formatTimeOfDay(item.scheduledAtMs)} · ${item.durationMinutes}m`;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group flex items-center gap-2 rounded-md px-1 py-0.5",
        isDragging && "opacity-40",
      )}
    >
      <input
        type="checkbox"
        checked={included}
        disabled={!canEdit}
        onChange={onToggleInclude}
        aria-label={included ? `Exclude ${item.title}` : `Include ${item.title}`}
        className="size-3.5 shrink-0 accent-primary"
      />
      <div {...listeners} {...attributes} className="flex min-w-0 flex-1 cursor-grab flex-col">
        <span className="truncate text-sm text-foreground">{item.title}</span>
        <span className="truncate text-2xs text-muted-foreground">{origin}</span>
      </div>
      {canEdit ? (
        <IconButton icon={X} label={`Remove ${item.title} from the schedule`} onClick={onRemove} />
      ) : null}
    </div>
  );
}

function TaskGroup({
  title,
  tasks,
  api,
  onOpenTask,
}: {
  title: string;
  tasks: Task[];
  api: TasksModuleApi;
  onOpenTask: (taskId: string) => void;
}) {
  if (tasks.length === 0) return null;
  return (
    <div className="flex shrink-0 flex-col gap-0.5">
      <Eyebrow as="div" className="px-1">
        {title} ({tasks.length})
      </Eyebrow>
      {tasks.map((task) => (
        <PanelTaskRow key={task.id} task={task} api={api} onOpen={() => onOpenTask(task.id)} />
      ))}
    </div>
  );
}

function PanelTaskRow({
  task,
  api,
  onOpen,
}: {
  task: Task;
  api: TasksModuleApi;
  onOpen: () => void;
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `cal-panel-task:${task.id}`,
    data: taskDrag(task.id, "list"),
    disabled: !api.canEdit,
  });
  const scheduled = formatScheduled(task.scheduledAt);
  const due = formatDue(task.dueDate);

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault(); // Space must not scroll — it's the button key
          onOpen();
        }
      }}
      className={cn(
        "group flex cursor-grab items-center gap-2 rounded-md px-1.5 hover:bg-accent/60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        isDragging && "opacity-40",
      )}
      style={{ minHeight: "var(--row-h-sm)" }}
    >
      <CompleteToggle
        done={task.status === "done"}
        disabled={!api.canEdit}
        onToggle={() => api.toggleDone(task)}
        aria-label={task.status === "done" ? `Reopen ${task.title}` : `Complete ${task.title}`}
      />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{task.title}</span>
      {task.durationMinutes ? (
        <span className="shrink-0 text-2xs text-muted-foreground">{task.durationMinutes}m</span>
      ) : null}
      {scheduled ? (
        <span
          className="flex shrink-0 items-center gap-0.5 text-2xs text-muted-foreground"
          aria-label={`Scheduled ${scheduled}`}
        >
          <CalendarCheck aria-hidden className="size-icon-xs" />
          {scheduled}
        </span>
      ) : due ? (
        <span className="shrink-0 text-2xs text-muted-foreground">{due}</span>
      ) : null}
      <GripVertical
        aria-hidden
        className="size-icon-xs shrink-0 text-muted-foreground/0 transition-colors duration-(--motion-fade) group-hover:text-muted-foreground/60"
      />
    </div>
  );
}
