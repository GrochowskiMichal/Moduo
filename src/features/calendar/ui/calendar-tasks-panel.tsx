// The right panel's Tasks view — the drag source (DESIGN_BRIEF §5, AC11):
// Today · Due soon · Backlog groups + search; rows drag onto the grid via the
// universal drag contract (the legacy TaskDragData payload, adapted by
// asDragPayload); the checkbox completes with the same op as everywhere.
// Already-scheduled rows show their time and sink to the bottom of their
// group — visibility beats purity.

import { useMemo, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CalendarCheck, GripVertical, Search } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { CompleteToggle } from "../../../components/ui/complete-toggle";
import { Input } from "../../../components/ui/input";
import { cn } from "@/lib/utils";
import { taskDrag } from "../../tasks/ui/dnd/task-dnd";
import { formatDue, formatScheduled } from "../../tasks/helpers";
import type { TasksModuleApi } from "../../tasks/hooks/use-tasks-module";
import type { Task } from "../../tasks/model";
import { groupPanelTasks } from "../panel";

type Props = {
  api: TasksModuleApi;
  onOpenTask: (taskId: string) => void;
  onRequestCapture: () => void;
};

export function CalendarTasksPanel({ api, onOpenTask, onRequestCapture }: Props) {
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

  const total =
    groups.today.length + groups.dueSoon.length + groups.backlog.length;

  return (
    <div className="scrollbar-thin flex h-full min-h-0 flex-col gap-2 overflow-y-auto">
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
      <div className="px-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        {title} ({tasks.length})
      </div>
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
        "group flex cursor-grab items-center gap-2 rounded-md px-1.5 hover:bg-accent",
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
        <span className="shrink-0 text-2xs text-muted-foreground">
          {task.durationMinutes}m
        </span>
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
