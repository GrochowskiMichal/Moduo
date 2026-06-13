import { useEffect, useState } from "react";
import { Check, Pause, Play, RotateCcw } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { SegmentedControl } from "../../../components/ui/segmented-control";
import { cn } from "../../../lib/utils";
import {
  ENERGY_LABELS,
  formatDue,
  formatScheduled,
  PRIORITY_LABELS,
} from "../helpers";
import type { Task } from "../model";

type TimerMode = "pomodoro" | "duration";

const POMODORO_WORK = 25 * 60;
const POMODORO_BREAK = 5 * 60;
const DURATION_FALLBACK_MIN = 25;

type Props = {
  committedTasks: Task[];
  bucketNameById: (id: string) => string;
  /** Parent title for committed subtasks — quiet "part of …" context. */
  parentTitleFor: (task: Task) => string | null;
  /** Quiet "Waiting on …" note for blocked tasks committed anyway (spec §5c). */
  blockedNoteFor: (task: Task) => string | null;
  onMarkDone: (id: string) => void;
  onSkip: (id: string) => void;
  onDoLast: (id: string) => void;
  onExit: () => void;
};

export function ExecuteView({
  committedTasks,
  bucketNameById,
  parentTitleFor,
  blockedNoteFor,
  onMarkDone,
  onSkip,
  onDoLast,
  onExit,
}: Props) {
  const current = committedTasks.find((t) => t.status !== "done") ?? null;
  const upcoming = committedTasks.filter((t) => t.status !== "done").slice(1);
  const total = committedTasks.length;
  const doneCount = committedTasks.filter((t) => t.status === "done").length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* heading matches the Plan-mode header (same place + style) */}
      <div className="mb-3 flex shrink-0 items-center">
        <h1 className="font-display text-lg text-foreground">Queue</h1>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {!current ? (
          <EndSummary doneCount={doneCount} total={total} onExit={onExit} />
        ) : (
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
            <NowCard
              task={current}
              bucketName={bucketNameById(current.bucketId)}
              parentTitle={parentTitleFor(current)}
              blockedNote={blockedNoteFor(current)}
              onMarkDone={() => onMarkDone(current.id)}
              onSkip={() => onSkip(current.id)}
              onDoLast={() => onDoLast(current.id)}
              canDoLast={upcoming.length > 0}
            />
            <Queue tasks={upcoming} bucketNameById={bucketNameById} parentTitleFor={parentTitleFor} />
          </div>
        )}
      </div>

      {/* progress mirror — quiet, back at the bottom (reads as a tally, not a heading) */}
      {current && total > 0 ? (
        <div className="mt-3 flex shrink-0 justify-center font-sans text-xs tabular-nums text-muted-foreground">
          {doneCount} / {total} done
        </div>
      ) : null}
    </div>
  );
}

function EndSummary({
  doneCount,
  total,
  onExit,
}: {
  doneCount: number;
  total: number;
  onExit: () => void;
}) {
  return (
    <div className="grid h-full place-content-center gap-4 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-foreground">
        <Check className="size-6" aria-hidden />
      </div>
      <p className="font-display text-2xl text-foreground tabular-nums">
        {doneCount} / {total} Done
      </p>
      <p className="font-sans text-sm text-muted-foreground">
        {total > 0 && doneCount === total ? "Queue cleared." : "That’s the queue."}
      </p>
      <Button variant="secondary" size="sm" onClick={onExit} className="mx-auto">
        Back to Plan
      </Button>
    </div>
  );
}

// ── Now card ──────────────────────────────────────────────────────────────────

function NowCard({
  task,
  bucketName,
  parentTitle,
  blockedNote,
  onMarkDone,
  onSkip,
  onDoLast,
  canDoLast,
}: {
  task: Task;
  bucketName: string;
  parentTitle: string | null;
  blockedNote: string | null;
  onMarkDone: () => void;
  onSkip: () => void;
  onDoLast: () => void;
  canDoLast: boolean;
}) {
  const [mode, setMode] = useState<TimerMode>("pomodoro");
  const timer = useExecuteTimer(task.id, mode, task.durationMinutes);

  const scheduled = formatScheduled(task.scheduledAt);
  const due = formatDue(task.dueDate);
  const meta = [
    // committed subtask: quiet context for which bigger thing this serves
    parentTitle ? `Part of ${parentTitle}` : null,
    // blocked-but-committed-anyway: a quiet mirror, never a wall (spec §5c)
    blockedNote,
    bucketName,
    task.priority ? PRIORITY_LABELS[task.priority] : null,
    task.energyLevel ? ENERGY_LABELS[task.energyLevel] : null,
    scheduled ? `Scheduled ${scheduled}` : null,
    due ? `Due ${due}` : null,
    task.durationMinutes ? `~${task.durationMinutes} min` : null,
  ].filter(Boolean) as string[];

  // Calm, centered focus card: title → context → timer → primary action.
  return (
    <div className="rounded-lg border border-border px-6 py-8 text-center">
      <h2 className="font-display text-2xl text-foreground">{task.title || "Untitled"}</h2>
      {meta.length ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 font-sans text-xs text-muted-foreground">
          {meta.map((m, i) => (
            <span key={m} className="flex items-center gap-2">
              {i > 0 ? <span className="text-muted-foreground/40">·</span> : null}
              {m}
            </span>
          ))}
        </div>
      ) : null}
      {task.description ? (
        <p className="mx-auto mt-3 max-w-md font-sans text-sm text-muted-foreground">{task.description}</p>
      ) : null}

      <div className="mt-6 flex flex-col items-center gap-2">
        <ModeToggle mode={mode} onModeChange={setMode} />
        {/* compact timer — body + tabular; secondary to the task details above */}
        <span className="mt-1 font-sans text-3xl tabular-nums text-foreground">
          {formatClock(timer.secondsLeft)}
        </span>
        <span className="font-sans text-2xs uppercase tracking-wide text-muted-foreground/70">
          {mode === "pomodoro" ? timer.phase : "remaining"}
        </span>
        <div className="mt-1 flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={timer.toggle}>
            {timer.running ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
            {timer.running ? "Pause" : "Resume"}
          </Button>
          <Button variant="secondary" size="sm" onClick={timer.reset} aria-label="Reset timer">
            <RotateCcw className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      <div className="mt-8 flex flex-col items-center gap-3">
        <Button size="md" onClick={onMarkDone} className="min-w-44">
          <Check className="size-4" aria-hidden />
          Done, next
        </Button>
        <div className="flex items-center gap-3 font-sans text-sm text-muted-foreground">
          <button type="button" onClick={onSkip} className="hover:text-foreground">
            Skip
          </button>
          {canDoLast ? (
            <>
              <span className="text-muted-foreground/40">·</span>
              <button type="button" onClick={onDoLast} className="hover:text-foreground">
                Do last
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ModeToggle({ mode, onModeChange }: { mode: TimerMode; onModeChange: (m: TimerMode) => void }) {
  return (
    <SegmentedControl
      aria-label="Timer mode"
      size="sm"
      value={mode}
      onValueChange={(value) => onModeChange(value as TimerMode)}
      items={[
        { value: "pomodoro", label: "Pomodoro" },
        { value: "duration", label: "Timer" },
      ]}
    />
  );
}

// ── relations (placeholder for cross-module links) ────────────────────────────

// ── queue ─────────────────────────────────────────────────────────────────────

function Queue({
  tasks,
  bucketNameById,
  parentTitleFor,
}: {
  tasks: Task[];
  bucketNameById: (id: string) => string;
  parentTitleFor: (task: Task) => string | null;
}) {
  if (tasks.length === 0) {
    return <p className="text-center font-sans text-sm text-muted-foreground">Last one — nothing else queued.</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      <p className="px-1 font-display text-2xs font-medium uppercase tracking-wide text-muted-foreground/70">
        Up next
      </p>
      {tasks.map((task, i) => (
        <div
          key={task.id}
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-0.5 text-sm",
            i >= 2 ? "opacity-50" : "opacity-100",
          )}
          style={{ minHeight: "var(--row-h)" }}
        >
          <span className="size-1.5 rounded-full bg-muted-foreground/50" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-display text-foreground">{task.title || "Untitled"}</span>
          {parentTitleFor(task) ? (
            <span className="min-w-0 shrink truncate font-sans text-xs text-muted-foreground/70">
              ↳ {parentTitleFor(task)}
            </span>
          ) : null}
          <span className="shrink-0 font-sans text-xs text-muted-foreground">{bucketNameById(task.bucketId)}</span>
        </div>
      ))}
    </div>
  );
}

// ── timer ─────────────────────────────────────────────────────────────────────

function useExecuteTimer(taskKey: string, mode: TimerMode, durationMin: number | null) {
  const durationSeconds = (durationMin && durationMin > 0 ? durationMin : DURATION_FALLBACK_MIN) * 60;

  const [phase, setPhase] = useState<"work" | "break">("work");
  const [secondsLeft, setSecondsLeft] = useState(mode === "pomodoro" ? POMODORO_WORK : durationSeconds);
  const [running, setRunning] = useState(true);

  // Fresh timer whenever the task or mode changes (auto-runs on entry).
  useEffect(() => {
    setPhase("work");
    setSecondsLeft(mode === "pomodoro" ? POMODORO_WORK : durationSeconds);
    setRunning(true);
  }, [taskKey, mode, durationSeconds]);

  // Tick.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  // Handle reaching zero.
  useEffect(() => {
    if (secondsLeft !== 0) return;
    if (mode === "pomodoro") {
      setPhase((p) => {
        const next = p === "work" ? "break" : "work";
        setSecondsLeft(next === "work" ? POMODORO_WORK : POMODORO_BREAK);
        return next;
      });
    } else {
      setRunning(false); // duration countdown finished
    }
  }, [secondsLeft, mode]);

  return {
    secondsLeft,
    phase,
    running,
    toggle: () => setRunning((r) => !r),
    reset: () => {
      setPhase("work");
      setSecondsLeft(mode === "pomodoro" ? POMODORO_WORK : durationSeconds);
      setRunning(true);
    },
  };
}

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
