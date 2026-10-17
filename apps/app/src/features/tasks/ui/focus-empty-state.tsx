// The Focus screen with nothing lined up (TV-F7, call 66): it teaches the three
// ways in. Exported for Tasks' welcome (TV-U17).

import { Plus } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";

import { Button } from "../../../components/ui/button";
import { IconButton } from "../../../components/ui/icon-button";
import { Kbd } from "../../../components/ui/kbd";
import { SELECTED_ROW } from "../../../components/ui/selection";
import { formatTime } from "../../../lib/time-format";
import { cn } from "../../../lib/utils";
import { type ScheduledToday, scheduledToday } from "../focus-screen";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import { nowOn, useToday } from "../use-today";

// ── the empty state: three ways in (66) ─────────────────────────────────────

/** What Focus is, in one line: the empty state's and Tasks' welcome's (TV-U17). */
export const FOCUS_WHAT_IT_IS =
  "Focus shows one task at a time, with the rest waiting in Up next. The timer is yours to use or turn off.";

/** The two keys that put a task in Focus: the empty state's and the welcome's
 *  (which says "to Focus" where the empty state says "here"). */
export function FocusKeyHints({ where = "here" }: { where?: string }) {
  return (
    <>
      <li>
        Press <Kbd>Q</Kbd> on any task to add it {where}.
      </li>
      <li>
        Press <Kbd>⇧F</Kbd> on a task to focus on it alone.
      </li>
    </>
  );
}

/**
 * Nothing lined up: Focus teaches its three ways in (call 66), with today's
 * scheduled tasks as real rows (click one for its details, "+" adds that one,
 * "Line up all n" adds them in time order). Exported for Tasks' welcome
 * (TV-U17), which shows this screen.
 */
export function FocusEmptyState({
  api,
  canEdit,
  bucketNameById,
  selectedTaskId,
  onSelectTask,
  onRequestCapture,
}: {
  api: Pick<
    TasksModuleApi,
    "tasks" | "sessions" | "currentUserId" | "queuedTaskIds" | "addToQueue" | "toggleQueue"
  >;
  canEdit: boolean;
  bucketNameById: (id: string) => string;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  onRequestCapture: () => void;
}) {
  const today = useToday();
  const rows = useMemo(
    () =>
      scheduledToday({
        tasks: api.tasks,
        sessions: api.sessions,
        me: api.currentUserId,
        now: nowOn(today),
        queuedIds: api.queuedTaskIds,
      }),
    [api.tasks, api.sessions, api.currentUserId, api.queuedTaskIds, today],
  );
  const lineUp = (list: ScheduledToday[]) => {
    for (const row of list) api.addToQueue(row.task.id, "end");
    if (list.length > 1) toast(`Lined up ${list.length} tasks`);
  };

  return (
    <section
      aria-label="Nothing lined up"
      data-slot="focus-empty"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card px-5 py-5"
    >
      <div className="flex flex-col gap-1">
        <p className="font-display text-lg text-foreground">
          Line up what you’ll do next, then press Start.
        </p>
        {/* First use (call 66, TV-U17 builds on this): what Focus is, in one line. */}
        <p className="font-sans text-sm text-muted-foreground">{FOCUS_WHAT_IT_IS}</p>
      </div>
      <ul className="flex flex-col gap-1.5 font-sans text-sm text-muted-foreground">
        <FocusKeyHints />
        <li>
          {rows.length > 0
            ? "Or start from what’s scheduled today:"
            : "Or plan your day: tasks you schedule for today show up here to line up."}
        </li>
      </ul>
      {rows.length > 0 ? (
        <ul className="flex flex-col" aria-label="Scheduled today" data-slot="focus-today">
          {rows.map((row) => {
            const selected = selectedTaskId === row.task.id;
            return (
              <li
                key={row.task.id}
                data-task-id={row.task.id}
                className={cn(
                  "group flex min-h-(--row-h) items-center gap-2 rounded-md px-1.5",
                  selected ? SELECTED_ROW : "hover:bg-state-hover",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelectTask(row.task.id)}
                  aria-current={selected ? "true" : undefined}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-sm py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <span className="min-w-0 flex-1 truncate font-sans text-sm text-foreground">
                    {row.task.title || "Untitled"}
                  </span>
                  <span className="shrink-0 font-sans text-xs text-muted-foreground">
                    {bucketNameById(row.task.bucketId)}
                  </span>
                  <span className="w-16 shrink-0 text-right font-sans text-xs tabular-nums text-muted-foreground">
                    {formatTime(row.at)}
                  </span>
                </button>
                {canEdit ? (
                  <IconButton
                    icon={Plus}
                    label="Add to Focus"
                    // One task, like Q: a blocked one offers its unblocked
                    // tasks first (the page's guarded toggle).
                    onClick={() => api.toggleQueue(row.task.id)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          {rows.length > 1 ? (
            <Button size="sm" variant="secondary" onClick={() => lineUp(rows)}>
              Line up all {rows.length}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onRequestCapture}>
            <Plus aria-hidden />
            New task
            <Kbd className="bg-transparent">C</Kbd>
          </Button>
        </div>
      ) : (
        <p className="font-sans text-xs text-subtle-foreground">
          Lining up tasks needs edit access to Tasks in this workspace.
        </p>
      )}
    </section>
  );
}
