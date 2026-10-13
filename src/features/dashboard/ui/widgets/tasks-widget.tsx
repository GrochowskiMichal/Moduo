// DB-5 → TV-H1 — "Tasks" widget. My Focus line-up in Focus's order (Now
// first), or, when nothing is lined up, the open tasks ("Open"). Inline
// check-off is the one write, gated by `canWrite` (a "view" member sees
// disabled checkboxes); it goes through the shared store with call 87's rule,
// so a parent's open subtasks finish too, with one Undo. Rows open the task.

import { Check } from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { useFocusTaskState } from "@/features/focus/timer";
import { checkOffWithSubtasks, restoreFocusPlace, undoCheckOff } from "@/features/tasks/check-off";
import { focusOrOpen } from "@/features/tasks/home";
import type { Task } from "@/features/tasks/model";
import { queueEntriesOf } from "@/features/tasks/queue";
import { teamIdsOf } from "@/features/tasks/teams";
import { getRuntime } from "@/lib/runtime";
import { findWorkspaceStore } from "@/lib/sync/store";
import { undoToast } from "@/lib/undo-toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";

import { useDashboardData } from "../../context/dashboard-data-context";
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
  now,
  canWrite,
  onDone,
}: {
  task: Task;
  /** The task a Focus session is on right now. */
  now: boolean;
  canWrite: boolean;
  onDone: (task: Task) => void;
}) {
  return (
    <li
      className="flex min-h-[var(--row-h)] items-center gap-2 rounded-md px-2 py-1 hover:bg-accent"
      data-now={now ? "" : undefined}
    >
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
        className={cn(
          "min-w-0 flex-1 truncate rounded-sm text-left text-sm text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          now && "font-medium",
        )}
      >
        {task.title}
      </button>
      {now ? <span className="shrink-0 text-2xs text-muted-foreground">Now</span> : null}
    </li>
  );
}

const subtaskWord = (n: number) => (n === 1 ? "1 subtask" : `${n} subtasks`);

export function TasksWidget({ widget, size, canWrite }: WidgetComponentProps) {
  const { tasks: taskSource, taskQueue, workspaceId } = useDashboardData();
  const { userId } = useAuth();
  const density = useDensity();
  const focus = useFocusTaskState();

  const projectIds = useMemo(
    () =>
      Array.isArray(widget.config.projectIds)
        ? (widget.config.projectIds as unknown[]).filter(
            (id): id is string => typeof id === "string",
          )
        : [],
    [widget.config.projectIds],
  );

  const tasks = taskSource.data.tasks;
  const teamMembers = taskSource.data.teamMembers;
  const sessionTaskId = focus.active && focus.workspaceId === workspaceId ? focus.taskId : null;
  const { rows, heading, nowId } = useMemo(
    () =>
      focusOrOpen({
        tasks,
        queue: taskQueue.data,
        userId,
        projectIds,
        sessionTaskId,
        myTeams: teamIdsOf(teamMembers ?? [], userId),
      }),
    [tasks, taskQueue.data, userId, projectIds, sessionTaskId, teamMembers],
  );

  // The newest copy and line-up, for an Undo that runs from a toast later.
  const latest = useRef({ tasks, queue: taskQueue.data });
  useLayoutEffect(() => {
    latest.current = { tasks, queue: taskQueue.data };
  });

  const markDone = useCallback(
    (task: Task) => {
      const runtime = getRuntime();
      if (!canWrite || !workspaceId || !runtime) return;
      // Home's tasks are the shared store's copy (TV-D11a): no store, no rows.
      const store = findWorkspaceStore(runtime, workspaceId);
      if (!store) return;
      // Finishing takes it out of my Focus on the server; Undo puts it back there.
      const lineupBefore = queueEntriesOf(latest.current.queue, userId).map((e) => e.taskId);
      void checkOffWithSubtasks(store, task, latest.current.tasks)
        .then(({ subtasks, refused }) => {
          if (refused > 0) toast.error(`Couldn’t finish ${subtaskWord(refused)}.`);
          // Call 87: "Done · also 2 subtasks", one Undo for all of them. The
          // row leaves the widget at once, so a lone check-off has an Undo too.
          const label =
            subtasks.length > 0 ? `Done · also ${subtaskWord(subtasks.length)}` : "Done";
          undoToast(label, {
            onUndo: () => {
              const current = (id: string) => latest.current.tasks.find((t) => t.id === id);
              void undoCheckOff(store, [task, ...subtasks], current)
                .then(async ({ restored, failed }) => {
                  if (failed > 0) toast.error("Couldn’t undo all of that.");
                  if (!restored.includes(task.id) || !lineupBefore.includes(task.id)) return;
                  await restoreFocusPlace(store, runtime.tasks, workspaceId, task.id, lineupBefore);
                })
                .catch(() => toast.error("Couldn’t put it back in Focus."));
            },
          });
        })
        .catch(() => toast.error("Couldn’t complete that task."));
    },
    [canWrite, workspaceId, userId],
  );

  if ((taskSource.loading || taskQueue.loading) && rows.length === 0) return <WidgetLoading />;
  if (rows.length === 0) {
    return <WidgetEmpty>No open tasks. Enjoy the calm.</WidgetEmpty>;
  }

  const budget = widgetRowBudget(size, density);
  const shown = rows.slice(0, budget);
  const overflow = rows.length - shown.length;

  return (
    <WidgetBodyRoot>
      {size !== "S" ? <WidgetSectionLabel count={rows.length}>{heading}</WidgetSectionLabel> : null}
      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto scrollbar-thin p-1.5 pt-0.5">
        {shown.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            now={heading === "Focus" && !!sessionTaskId && task.id === nowId}
            canWrite={canWrite}
            onDone={markDone}
          />
        ))}
      </ul>
      <WidgetMore count={overflow} onClick={() => openModuleRoute("/tasks")} />
    </WidgetBodyRoot>
  );
}
