// DB-5 — "Tasks" widget. My queue (TV-D4; falls back to the open tasks),
// with inline check-off — the one write this widget does, gated by `canWrite`
// (a "view" member sees disabled checkboxes). Rows open the task in /tasks.

import { Check } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Task } from "@/features/tasks/model";
import { queueOrOpen } from "@/features/tasks/queue";
import { getRuntime } from "@/lib/runtime";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";

import {
  requestDashboardDataRefresh,
  useDashboardData,
} from "../../context/dashboard-data-context";
import { useDensity } from "../../hooks/use-density";
import type { WidgetComponentProps } from "../../registry/types";
import { widgetRowBudget } from "../../widget-density";
import { openEntity, openModuleRoute } from "../../widget-nav";
import {
  WidgetBodyRoot,
  WidgetEmpty,
  WidgetLoading,
  WidgetMore,
  WidgetSectionLabel,
} from "./widget-primitives";

function TaskRow({
  task,
  canWrite,
  onDone,
}: {
  task: Task;
  canWrite: boolean;
  onDone: (task: Task) => void;
}) {
  return (
    <li className="flex min-h-[var(--row-h)] items-center gap-2 rounded-md px-2 py-1 hover:bg-accent">
      <button
        type="button"
        disabled={!canWrite}
        onClick={() => onDone(task)}
        aria-label={`Mark "${task.title}" done`}
        className={cn(
          "grid size-icon-lg shrink-0 place-items-center rounded-full border border-border text-transparent",
          canWrite
            ? "hover:border-foreground/40 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            : "opacity-50",
        )}
      >
        <Check className="size-icon-xs" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => openEntity("task", task.id)}
        className="min-w-0 flex-1 truncate rounded-sm text-left text-sm text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {task.title}
      </button>
    </li>
  );
}

export function TasksWidget({ widget, size, canWrite }: WidgetComponentProps) {
  const { tasks: taskSource, taskQueue, workspaceId } = useDashboardData();
  const { userId } = useAuth();
  const density = useDensity();
  const [doneIds, setDoneIds] = useState<Set<string>>(() => new Set());

  const projectIds = useMemo(
    () =>
      Array.isArray(widget.config.projectIds)
        ? (widget.config.projectIds as unknown[]).filter(
            (id): id is string => typeof id === "string",
          )
        : [],
    [widget.config.projectIds],
  );

  const { rows, heading } = useMemo(
    () => queueOrOpen(taskSource.data.tasks, taskQueue.data, userId, projectIds),
    [taskSource.data.tasks, taskQueue.data, userId, projectIds],
  );

  const markDone = useCallback(
    (task: Task) => {
      const runtime = getRuntime();
      if (!canWrite || !workspaceId || !runtime) return;
      setDoneIds((prev) => new Set(prev).add(task.id));
      void runtime.tasks
        .opSetStatus({ workspaceId, taskId: task.id, status: "done" })
        .then(() => requestDashboardDataRefresh())
        .catch(() => {
          setDoneIds((prev) => {
            const next = new Set(prev);
            next.delete(task.id);
            return next;
          });
          toast.error("Couldn't complete that task.");
        });
    },
    [canWrite, workspaceId],
  );

  const visible = rows.filter((t) => !doneIds.has(t.id));

  if ((taskSource.loading || taskQueue.loading) && rows.length === 0) return <WidgetLoading />;
  if (visible.length === 0) {
    return <WidgetEmpty>No open tasks. Enjoy the calm.</WidgetEmpty>;
  }

  const budget = widgetRowBudget(size, density);
  const shown = visible.slice(0, budget);
  const overflow = visible.length - shown.length;

  return (
    <WidgetBodyRoot>
      {size !== "S" ? (
        <WidgetSectionLabel count={visible.length}>{heading}</WidgetSectionLabel>
      ) : null}
      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto scrollbar-thin p-1.5 pt-0.5">
        {shown.map((task) => (
          <TaskRow key={task.id} task={task} canWrite={canWrite} onDone={markDone} />
        ))}
      </ul>
      <WidgetMore count={overflow} onClick={() => openModuleRoute("/tasks")} />
    </WidgetBodyRoot>
  );
}
