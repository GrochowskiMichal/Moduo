// DB-6 — "Pomodoro" widget (S), on the one time engine since TV-F6 (spec §6.10,
// TV-F5 folded in): it shows and controls the same session as Focus, the
// top-bar timer and Calendar's blocks, so a pomodoro started here is saved to
// the task it ran on, from any page, and survives navigation. Idle, Start runs
// a Pomodoro on the top of Up next; with nothing lined up it says so. The
// lengths are your Focus lengths (Settings → Focus, or this widget's settings).

import { isClosedTask } from "@contracts/vocabularies";
import { Pause, Play, Square } from "lucide-react";
import { useMemo } from "react";

import { Eyebrow } from "@/components/ui/eyebrow";
import { IconButton } from "@/components/ui/icon-button";
import { formatFocusClock } from "@/features/focus/clock";
import { stopFocusWithUndo } from "@/features/focus/stop-with-undo";
import { focusOn, toggleFocusPause, useFocusTimer } from "@/features/focus/timer";
import { queueEntriesOf } from "@/features/tasks/queue";
import { useFocusPrefs } from "@/lib/focus-prefs";
import { getRuntime } from "@/lib/runtime";
import { useStoreSnapshot, useWorkspaceStore } from "@/lib/sync/react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import { useWorkspace } from "@/providers/workspace-provider";

import type { WidgetComponentProps } from "../../registry/types";

/** The first open task of my Up next, from the shared store the shell holds. */
function useUpNextHead() {
  const { userId } = useAuth();
  const { selectedWorkspaceId, modulePermissions } = useWorkspace();
  const store = useWorkspaceStore(
    getRuntime(),
    userId,
    selectedWorkspaceId,
    modulePermissions.tasks !== "none",
  );
  const snap = useStoreSnapshot(store);
  return useMemo(() => {
    if (!snap.workspaceId) return null;
    const byId = new Map(snap.bundle.tasks.map((t) => [t.id, t]));
    for (const entry of queueEntriesOf(snap.queue, userId)) {
      const task = byId.get(entry.taskId);
      if (!task || task.deletedAt || isClosedTask(task) || task.id.startsWith("tmp-")) continue;
      return {
        id: task.id,
        title: task.title || "Untitled",
        bucketName: snap.bundle.buckets.find((b) => b.id === task.bucketId)?.name ?? null,
        workspaceId: snap.workspaceId,
      };
    }
    return null;
  }, [snap, userId]);
}

export function PomodoroWidget({ canWrite }: WidgetComponentProps) {
  const timer = useFocusTimer();
  const { prefs } = useFocusPrefs();
  const head = useUpNextHead();

  const pomodoro = timer.active && timer.timer === "pomodoro";
  const eyebrow = !timer.active
    ? "Pomodoro"
    : pomodoro && timer.phase === "break"
      ? timer.longBreak
        ? "Long break"
        : "Break"
      : "Focus";
  const clock = !timer.active
    ? formatFocusClock(prefs.workMinutes * 60)
    : timer.timer === "off"
      ? null
      : formatFocusClock(timer.bigClock);
  const progress =
    pomodoro && timer.phaseSeconds > 0
      ? Math.min(
          100,
          Math.max(0, ((timer.phaseSeconds - timer.bigClock) / timer.phaseSeconds) * 100),
        )
      : 0;
  const caption = timer.active
    ? timer.taskTitle || "Untitled"
    : head
      ? `Next: ${head.title}`
      : "Nothing in Up next";

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-3">
      <Eyebrow>{eyebrow}</Eyebrow>
      {clock ? (
        <p className="font-display text-3xl font-semibold tabular-nums text-foreground">{clock}</p>
      ) : null}
      {pomodoro ? (
        <div className="h-1 w-full max-w-[8rem] overflow-hidden rounded-full bg-foreground/15">
          <div
            className="h-full rounded-full bg-foreground/70 transition-[width] duration-[var(--motion-fade)]"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : null}
      <p className="max-w-full text-center text-xs text-muted-foreground">{caption}</p>
      <div className="flex items-center gap-1">
        {timer.active ? (
          <>
            <IconButton
              icon={timer.running ? Pause : Play}
              label={timer.running ? "Pause" : "Resume"}
              onClick={() => toggleFocusPause()}
            />
            <IconButton icon={Square} label="Stop" onClick={stopFocusWithUndo} />
          </>
        ) : (
          <button
            type="button"
            disabled={!head || !canWrite}
            onClick={() => {
              if (head) focusOn(head, { timer: "pomodoro" });
            }}
            aria-label={head ? `Start a pomodoro on ${head.title}` : "Start a pomodoro"}
            className={cn(
              "grid size-[var(--ctrl-h-sm)] place-items-center rounded-full bg-primary text-primary-foreground",
              "hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            <Play className="size-icon-sm" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
