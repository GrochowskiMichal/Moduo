import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Clock, MoreHorizontal, Pause, Play, Square } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { IconButton } from "../../../components/ui/icon-button";
import { Input } from "../../../components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import { formatDue, formatScheduled } from "../helpers";
import type { Task } from "../model";

const DEFAULT_WORK_MIN = 25;
const DEFAULT_BREAK_MIN = 5;
// Persist accrued time periodically so a crash/reload loses at most this much.
const FLUSH_INTERVAL_SECONDS = 60;

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
  /** Fold an elapsed work delta (seconds) into the task's tracked total. */
  onAddTime: (taskId: string, deltaSeconds: number) => void;
  /** Set the tracked total to an absolute value (manual edit). */
  onSetTime: (taskId: string, seconds: number) => void;
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
  onAddTime,
  onSetTime,
  onExit,
}: Props) {
  const current = committedTasks.find((t) => t.status !== "done") ?? null;
  const upcoming = committedTasks.filter((t) => t.status !== "done").slice(1);
  const total = committedTasks.length;
  const doneCount = committedTasks.filter((t) => t.status === "done").length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex shrink-0 items-center">
        <h1 className="font-display text-lg text-foreground">Focus</h1>
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
              onAddTime={onAddTime}
              onSetTime={onSetTime}
              canDoLast={upcoming.length > 0}
            />
            <Queue tasks={upcoming} bucketNameById={bucketNameById} parentTitleFor={parentTitleFor} />
          </div>
        )}
      </div>

      {current && total > 0 ? (
        <div className="mt-3 flex shrink-0 justify-center font-sans text-xs tabular-nums text-muted-foreground">
          {doneCount} / {total} done
        </div>
      ) : null}
    </div>
  );
}

function EndSummary({ doneCount, total, onExit }: { doneCount: number; total: number; onExit: () => void }) {
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

// ── Now card — task-first; the timer is opt-in, tucked bottom-left ────────────

function NowCard({
  task,
  bucketName,
  parentTitle,
  blockedNote,
  onMarkDone,
  onSkip,
  onDoLast,
  onAddTime,
  onSetTime,
  canDoLast,
}: {
  task: Task;
  bucketName: string;
  parentTitle: string | null;
  blockedNote: string | null;
  onMarkDone: () => void;
  onSkip: () => void;
  onDoLast: () => void;
  onAddTime: (taskId: string, deltaSeconds: number) => void;
  onSetTime: (taskId: string, seconds: number) => void;
  canDoLast: boolean;
}) {
  const timer = useFocusTimer(task.id, onAddTime);

  const scheduled = formatScheduled(task.scheduledAt);
  const due = formatDue(task.dueDate);
  const subLine =
    blockedNote ??
    [
      parentTitle ? `Part of ${parentTitle}` : null,
      due ? `Due ${due}` : scheduled ? `Scheduled ${scheduled}` : null,
      task.durationMinutes ? `~${task.durationMinutes}m est` : null,
    ]
      .filter(Boolean)
      .join("  ·  ");

  const trackedTotal = task.timeSpentSeconds + timer.accrued;
  const estimateSeconds = task.durationMinutes ? task.durationMinutes * 60 : null;

  return (
    // elevated: --popover sits one step lighter than the --card panel (no shadow —
    // surface contrast carries elevation on dark). Left-aligned, task-first.
    <div className="rounded-lg border border-border bg-popover px-6 py-5">
      <p className="font-display text-2xs font-medium uppercase tracking-wide text-muted-foreground/70">{bucketName}</p>
      <h2 className="mt-0.5 font-display text-2xl text-foreground">{task.title || "Untitled"}</h2>
      {subLine ? <p className="mt-1 font-sans text-xs text-muted-foreground">{subLine}</p> : null}
      {task.description ? (
        <p className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed text-muted-foreground">
          {task.description}
        </p>
      ) : null}

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
        {/* bottom-left — opt-in time tracking */}
        <div className="min-w-0">
          {timer.tracking ? (
            <div className="flex items-center gap-1.5">
              {timer.running ? <span className="size-2 rounded-full bg-muted-foreground" aria-hidden /> : null}
              <span className="mr-1 font-sans text-lg tabular-nums text-foreground">{formatClock(timer.bigClock)}</span>
              <IconButton
                icon={timer.running ? Pause : Play}
                label={timer.running ? "Pause" : "Resume"}
                onClick={timer.toggle}
              />
              <IconButton icon={Square} label="Stop" onClick={timer.stop} />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="ml-0.5 cursor-default font-sans text-xs tabular-nums text-muted-foreground">
                    {timer.pomodoro ? <span className="uppercase tracking-wide text-muted-foreground/70">{timer.phase} · </span> : null}
                    {formatDuration(trackedTotal)}
                    {estimateSeconds ? <span className="text-muted-foreground/60"> / ~{formatDuration(estimateSeconds)}</span> : null}
                  </span>
                </TooltipTrigger>
                <TooltipContent>Total time tracked on this task</TooltipContent>
              </Tooltip>
              <TimerMenu task={task} onAddTime={onAddTime} onSetTime={onSetTime} timer={timer} />
            </div>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={timer.start}>
                  <Clock className="size-icon-sm" aria-hidden />
                  {trackedTotal > 0 ? formatDuration(trackedTotal) : "Track time"}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {trackedTotal > 0 ? "Total time tracked · click to keep tracking" : "Start tracking time"}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* bottom-right — Skip / Do last / Done */}
        <div className="flex shrink-0 items-center gap-3">
          <button type="button" onClick={onSkip} className="font-sans text-sm text-muted-foreground hover:text-foreground">
            Skip
          </button>
          {canDoLast ? (
            <button type="button" onClick={onDoLast} className="font-sans text-sm text-muted-foreground hover:text-foreground">
              Do last
            </button>
          ) : null}
          <Button size="md" onClick={onMarkDone}>
            <Check className="size-icon-sm" aria-hidden />
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── ⋯ popover — manual add / set total / Pomodoro intervals ───────────────────

function TimerMenu({
  task,
  onAddTime,
  onSetTime,
  timer,
}: {
  task: Task;
  onAddTime: (taskId: string, deltaSeconds: number) => void;
  onSetTime: (taskId: string, seconds: number) => void;
  timer: ReturnType<typeof useFocusTimer>;
}) {
  const [setMin, setSetMin] = useState("");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton icon={MoreHorizontal} label="Timer options" tooltip={null} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 text-left">
        <div className="flex flex-col gap-3">
          <div>
            <p className="font-display text-2xs font-medium uppercase tracking-wide text-muted-foreground">Add time</p>
            <div className="mt-1.5 flex gap-1.5">
              {[5, 15, 30].map((m) => (
                <Button key={m} variant="secondary" size="sm" onClick={() => onAddTime(task.id, m * 60)}>
                  +{m}m
                </Button>
              ))}
            </div>
          </div>

          <div>
            <p className="font-display text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              Set total (min)
            </p>
            <div className="mt-1.5 flex items-center gap-1.5">
              <Input
                size="sm"
                type="number"
                min={0}
                value={setMin}
                placeholder={String(Math.round(task.timeSpentSeconds / 60))}
                onChange={(e) => setSetMin(e.target.value)}
                className="w-20"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const n = Number(setMin);
                  if (Number.isFinite(n) && setMin !== "") onSetTime(task.id, Math.max(0, n) * 60);
                  setSetMin("");
                }}
              >
                Set
              </Button>
            </div>
          </div>

          <div className="border-t border-border pt-3">
            <p className="font-display text-2xs font-medium uppercase tracking-wide text-muted-foreground">Pomodoro</p>
            <div className="mt-1.5 flex items-center gap-2 font-sans text-sm text-muted-foreground">
              <span>Work</span>
              <Input
                size="sm"
                type="number"
                min={1}
                value={timer.workMin}
                onChange={(e) => timer.setWorkMin(Math.max(1, Number(e.target.value) || 1))}
                className="w-14"
              />
              <span>Break</span>
              <Input
                size="sm"
                type="number"
                min={1}
                value={timer.breakMin}
                onChange={(e) => timer.setBreakMin(Math.max(1, Number(e.target.value) || 1))}
                className="w-14"
              />
            </div>
            <label className="mt-2 flex cursor-pointer items-center gap-2 font-sans text-sm text-muted-foreground">
              <input type="checkbox" checked={timer.pomodoro} onChange={timer.togglePomodoro} />
              Pomodoro rhythm
            </label>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

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

/**
 * Opt-in stopwatch (never auto-starts) + optional Pomodoro overlay. `tracking`
 * is whether the timer is open; `running` whether the clock ticks. Real *work*
 * seconds accrue into the task's persisted total via onAddTime — flushed on
 * pause / Stop / task change / unmount / every minute (attribution by ref). With
 * Pomodoro on, the big clock shows the work/break countdown and breaks don't
 * accrue; otherwise it counts the sitting up.
 */
function useFocusTimer(taskKey: string, onAddTime: (taskId: string, deltaSeconds: number) => void) {
  const [tracking, setTracking] = useState(false);
  const [running, setRunning] = useState(false);
  const [pomodoro, setPomodoro] = useState(false);
  const [phase, setPhase] = useState<"work" | "break">("work");
  const [pomoLeft, setPomoLeft] = useState(DEFAULT_WORK_MIN * 60);
  const [sitElapsed, setSitElapsed] = useState(0);
  const [accrued, setAccrued] = useState(0);
  const [workMin, setWorkMin] = useState(DEFAULT_WORK_MIN);
  const [breakMin, setBreakMin] = useState(DEFAULT_BREAK_MIN);

  const unflushedRef = useRef(0);
  const taskRef = useRef(taskKey);
  const addRef = useRef(onAddTime);
  addRef.current = onAddTime;

  const flush = useCallback(() => {
    if (unflushedRef.current >= 1) {
      addRef.current(taskRef.current, unflushedRef.current);
      unflushedRef.current = 0;
      setAccrued(0);
    }
  }, []);

  // new task: flush the prior task on cleanup, then reset to the resting state
  // (never auto-starts — tracking + running both false)
  useEffect(() => {
    taskRef.current = taskKey;
    setTracking(false);
    setRunning(false);
    setPhase("work");
    setPomoLeft(workMin * 60);
    setSitElapsed(0);
    setAccrued(0);
    unflushedRef.current = 0;
    return () => flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskKey, flush]);

  // tick
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setSitElapsed((s) => s + 1);
      const isWork = !pomodoro || phase === "work";
      if (isWork) {
        unflushedRef.current += 1;
        setAccrued((a) => a + 1);
      }
      if (pomodoro) setPomoLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [running, pomodoro, phase]);

  // Pomodoro phase rollover
  useEffect(() => {
    if (!pomodoro || pomoLeft !== 0) return;
    setPhase((p) => {
      const next = p === "work" ? "break" : "work";
      setPomoLeft((next === "work" ? workMin : breakMin) * 60);
      return next;
    });
  }, [pomoLeft, pomodoro, workMin, breakMin]);

  // periodic flush so a crash loses at most FLUSH_INTERVAL_SECONDS
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(flush, FLUSH_INTERVAL_SECONDS * 1000);
    return () => window.clearInterval(id);
  }, [running, flush]);

  return {
    tracking,
    running,
    pomodoro,
    phase,
    sitElapsed,
    accrued,
    workMin,
    breakMin,
    setWorkMin,
    setBreakMin,
    bigClock: pomodoro ? pomoLeft : sitElapsed,
    start: () => {
      setTracking(true);
      setRunning(true);
      setSitElapsed(0);
      setPhase("work");
      setPomoLeft(workMin * 60);
    },
    toggle: () =>
      setRunning((r) => {
        if (r) flush();
        return !r;
      }),
    stop: () => {
      flush();
      setRunning(false);
      setTracking(false);
      setSitElapsed(0);
      setPhase("work");
      setPomoLeft(workMin * 60);
    },
    togglePomodoro: () =>
      setPomodoro((on) => {
        setPhase("work");
        setPomoLeft(workMin * 60);
        return !on;
      }),
  };
}

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}
