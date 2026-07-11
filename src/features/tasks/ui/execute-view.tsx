import { useEffect, useState } from "react";
import { Check, Clock, MoreHorizontal, Pause, Play, Plus, Square } from "lucide-react";
import { toast } from "sonner";

import { Button } from "../../../components/ui/button";
import { IconButton } from "../../../components/ui/icon-button";
import { Input } from "../../../components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { CompleteToggle } from "../../../components/ui/complete-toggle";
import { TagChipList } from "../../../components/tag-chip";
import { EntityRichText } from "../../spine/ui/entity-rich-text";
import { cn } from "../../../lib/utils";
import { dispatchOpenSettings } from "../../settings/settings-events";
import { useFocusPrefs, type FocusPrefs } from "../../../lib/focus-prefs";
import {
  bindFocusTask,
  previewFocusInterval,
  startFocus,
  stopFocus,
  toggleFocusPomodoro,
  toggleFocusRunning,
  useFocusSession,
} from "../focus-session-store";
import { formatDue, formatScheduled } from "../helpers";
import type { Task, Tag } from "../model";

type Props = {
  committedTasks: Task[];
  bucketNameById: (id: string) => string;
  /** Parent title for committed subtasks — quiet "part of …" context. */
  parentTitleFor: (task: Task) => string | null;
  /** Quiet "Waiting on …" note for blocked tasks committed anyway (spec §5c). */
  blockedNoteFor: (task: Task) => string | null;
  onMarkDone: (id: string) => void;
  onSkip: (id: string) => void;
  /** Fold an elapsed work delta (seconds) into the task's tracked total. */
  onAddTime: (taskId: string, deltaSeconds: number) => void;
  /** Set the tracked total to an absolute value (manual edit). */
  onSetTime: (taskId: string, seconds: number) => void;
  tagsFor: (taskId: string) => Tag[];
  subtasksFor: (taskId: string) => Task[];
  onToggleSubtask: (subtask: Task) => void;
  onExit: () => void;
  /** Whether the Tasks bundle is still loading — gates the session bind so a
   *  transient empty queue on remount can't clear a live focus session (DF-11). */
  loading: boolean;
  canEdit: boolean;
  /** Capture a new task straight into today's queue (empty-queue affordance). */
  onCaptureToQueue: (title: string) => void;
};

export function ExecuteView({
  committedTasks,
  bucketNameById,
  parentTitleFor,
  blockedNoteFor,
  onMarkDone,
  onSkip,
  onAddTime,
  onSetTime,
  tagsFor,
  subtasksFor,
  onToggleSubtask,
  onExit,
  loading,
  canEdit,
  onCaptureToQueue,
}: Props) {
  const current = committedTasks.find((t) => t.status !== "done") ?? null;
  const upcoming = committedTasks.filter((t) => t.status !== "done").slice(1);
  const total = committedTasks.length;
  const doneCount = committedTasks.filter((t) => t.status === "done").length;
  // Pomodoro prefs (persisted) — the timer reads these; the ⋯ popover edits them.
  const { prefs: focusPrefs, setPrefs: setFocusPrefs } = useFocusPrefs();

  // Keep the app-level focus session bound to the current task (DF-11). Gated on
  // `!loading` so the transient empty bundle during a /tasks remount doesn't
  // clear a running session; when the last task is marked done `current` goes
  // null and the session ends (its time already flushed).
  useEffect(() => {
    if (loading) return;
    // Never bind to an optimistic `tmp-` id (a just-captured task): flushing its
    // accrued time later would hit a row swapped to its real id and lose it.
    // The real id arrives in a beat and re-runs this effect.
    if (current && current.id.startsWith("tmp-")) return;
    bindFocusTask(
      current?.id ?? null,
      current?.title || "Untitled",
      current ? bucketNameById(current.bucketId) : null,
    );
  }, [loading, current?.id, current?.title, current?.bucketId, bucketNameById]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex shrink-0 items-center">
        <h1 className="font-display text-lg text-foreground">Focus</h1>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {!current ? (
          <EndSummary
            doneCount={doneCount}
            total={total}
            onExit={onExit}
            canEdit={canEdit}
            onCaptureToQueue={onCaptureToQueue}
          />
        ) : (
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
            <NowCard
              task={current}
              bucketName={bucketNameById(current.bucketId)}
              parentTitle={parentTitleFor(current)}
              blockedNote={blockedNoteFor(current)}
              onMarkDone={() => onMarkDone(current.id)}
              onSkip={() => onSkip(current.id)}
              onAddTime={onAddTime}
              onSetTime={onSetTime}
              tags={tagsFor(current.id)}
              subtasks={subtasksFor(current.id)}
              onToggleSubtask={onToggleSubtask}
              focusPrefs={focusPrefs}
              onFocusPrefsChange={setFocusPrefs}
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

function EndSummary({
  doneCount,
  total,
  onExit,
  canEdit,
  onCaptureToQueue,
}: {
  doneCount: number;
  total: number;
  onExit: () => void;
  canEdit: boolean;
  onCaptureToQueue: (title: string) => void;
}) {
  const [value, setValue] = useState("");
  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onCaptureToQueue(trimmed);
    setValue("");
  };
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
      {/* Empty queue isn't a dead end — capture one more straight into today (DF-11). */}
      {canEdit ? (
        <div className="mx-auto flex w-full max-w-sm items-center gap-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Add one more…"
            aria-label="Add a task to today’s focus queue"
          />
          <Button size="sm" onClick={submit} disabled={!value.trim()}>
            <Plus className="size-icon-sm" aria-hidden />
            Add
          </Button>
        </div>
      ) : null}
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
  onAddTime,
  onSetTime,
  tags,
  subtasks,
  onToggleSubtask,
  focusPrefs,
  onFocusPrefsChange,
}: {
  task: Task;
  bucketName: string;
  parentTitle: string | null;
  blockedNote: string | null;
  onMarkDone: () => void;
  onSkip: () => void;
  onAddTime: (taskId: string, deltaSeconds: number) => void;
  onSetTime: (taskId: string, seconds: number) => void;
  tags: Tag[];
  subtasks: Task[];
  onToggleSubtask: (subtask: Task) => void;
  focusPrefs: FocusPrefs;
  onFocusPrefsChange: (patch: Partial<FocusPrefs>) => void;
}) {
  const session = useFocusSession();
  // The session is app-level; only read its clock when it's bound to THIS task
  // (defensive — the bind effect keeps them in step while Execute is mounted).
  const isThisTask = session.taskId === task.id;
  const tracking = isThisTask && session.tracking;
  const running = isThisTask && session.running;
  const accrued = isThisTask ? session.accrued : 0;

  // Live-preview the pomodoro interval while paused/idle when the prefs change.
  useEffect(() => {
    previewFocusInterval(focusPrefs);
  }, [
    focusPrefs.workMinutes,
    focusPrefs.breakMinutes,
    focusPrefs.longBreakMinutes,
    session.phase,
    session.longBreak,
  ]);

  const scheduled = formatScheduled(task.scheduledAt);
  const due = formatDue(task.dueDate);
  const subLine =
    blockedNote ??
    [
      parentTitle ? `Part of ${parentTitle}` : null,
      scheduled ? `Scheduled ${scheduled}` : null,
      task.durationMinutes ? `~${task.durationMinutes}m est` : null,
    ]
      .filter(Boolean)
      .join("  ·  ");

  const trackedTotal = task.timeSpentSeconds + accrued;
  const estimateSeconds = task.durationMinutes ? task.durationMinutes * 60 : null;

  return (
    // elevated: --popover sits one step lighter than the --card panel (no shadow —
    // surface contrast carries elevation on dark). Left-aligned, task-first.
    <div className="rounded-lg border border-border bg-popover px-6 py-5">
      <div className="flex items-center justify-between gap-3">
        <p className="shrink-0 font-display text-2xs font-medium uppercase tracking-wide text-muted-foreground/70">
          {bucketName}
        </p>
        <div className="flex min-w-0 items-center justify-end gap-2">
          {due ? <span className="shrink-0 font-sans text-2xs text-muted-foreground">Due {due}</span> : null}
          {tags.length ? <TagChipList tags={tags} max={3} className="min-w-0" /> : null}
        </div>
      </div>
      <h2 className="mt-0.5 font-display text-2xl text-foreground">{task.title || "Untitled"}</h2>
      {subLine ? <p className="mt-1 font-sans text-xs text-muted-foreground">{subLine}</p> : null}
      {task.description ? (
        <EntityRichText
          html={task.description}
          className="mt-3 font-sans text-sm leading-relaxed text-muted-foreground"
        />
      ) : null}

      {subtasks.length > 0 ? <SubtaskChecklist subtasks={subtasks} onToggle={onToggleSubtask} /> : null}

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
        {/* bottom-left — opt-in time tracking */}
        <div className="min-w-0">
          {tracking ? (
            <div className="flex items-center gap-1.5">
              {running ? <span className="track-pulse size-2 rounded-full bg-muted-foreground" aria-hidden /> : null}
              <span className="mr-1 font-sans text-lg tabular-nums text-foreground">
                {formatClock(isThisTask ? session.bigClock : 0)}
              </span>
              <IconButton
                icon={running ? Pause : Play}
                label={running ? "Pause" : "Resume"}
                onClick={toggleFocusRunning}
              />
              <IconButton icon={Square} label="Stop" onClick={stopFocus} />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="ml-0.5 cursor-default font-sans text-xs tabular-nums text-muted-foreground">
                    {session.pomodoro ? (
                      <span className="uppercase tracking-wide text-muted-foreground/70">
                        {session.phaseLabel} ·{" "}
                      </span>
                    ) : null}
                    {formatDuration(trackedTotal)}
                    {estimateSeconds ? <span className="text-muted-foreground/60"> / ~{formatDuration(estimateSeconds)}</span> : null}
                  </span>
                </TooltipTrigger>
                <TooltipContent>Total time tracked on this task</TooltipContent>
              </Tooltip>
              <TimerMenu
                task={task}
                onAddTime={onAddTime}
                onSetTime={onSetTime}
                pomodoro={session.pomodoro}
                onTogglePomodoro={toggleFocusPomodoro}
                prefs={focusPrefs}
                onPrefsChange={onFocusPrefsChange}
              />
            </div>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (task.id.startsWith("tmp-")) {
                      toast.error("Still saving that task — try again in a moment.");
                      return;
                    }
                    bindFocusTask(task.id, task.title || "Untitled", bucketName);
                    startFocus();
                  }}
                >
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

        {/* bottom-right — Skip / Done (reorder lives in the Queue now) */}
        <div className="flex shrink-0 items-center gap-3">
          <button type="button" onClick={onSkip} className="font-sans text-sm text-muted-foreground hover:text-foreground">
            Skip
          </button>
          <Button size="md" onClick={onMarkDone}>
            <Check className="size-icon-sm" aria-hidden />
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── subtask checklist — tick the pieces off while focusing the parent ─────────

function SubtaskChecklist({ subtasks, onToggle }: { subtasks: Task[]; onToggle: (subtask: Task) => void }) {
  const done = subtasks.filter((s) => s.status === "done").length;
  return (
    <div className="mt-4">
      <p className="font-display text-2xs font-medium uppercase tracking-wide text-muted-foreground/70">
        Subtasks {done}/{subtasks.length}
      </p>
      <div className="mt-1.5 flex flex-col">
        {subtasks.map((st) => {
          const isDone = st.status === "done";
          return (
            <div key={st.id} className="flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-accent">
              <CompleteToggle done={isDone} onToggle={() => onToggle(st)} />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate font-sans text-sm",
                  isDone ? "text-muted-foreground line-through" : "text-foreground",
                )}
              >
                {st.title || "Untitled"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── ⋯ popover — manual add / set total / Pomodoro intervals ───────────────────

function TimerMenu({
  task,
  onAddTime,
  onSetTime,
  pomodoro,
  onTogglePomodoro,
  prefs,
  onPrefsChange,
}: {
  task: Task;
  onAddTime: (taskId: string, deltaSeconds: number) => void;
  onSetTime: (taskId: string, seconds: number) => void;
  pomodoro: boolean;
  onTogglePomodoro: () => void;
  prefs: FocusPrefs;
  onPrefsChange: (patch: Partial<FocusPrefs>) => void;
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

          {/* Pomodoro — work/break edit the persisted Focus prefs (Settings →
              Focus holds long break / auto-start / sound). */}
          <div className="border-t border-border pt-3">
            <p className="font-display text-2xs font-medium uppercase tracking-wide text-muted-foreground">Pomodoro</p>
            <div className="mt-1.5 flex items-center gap-2 font-sans text-sm text-muted-foreground">
              <span>Work</span>
              <Input
                size="sm"
                type="number"
                min={1}
                max={180}
                value={String(prefs.workMinutes)}
                onChange={(e) => onPrefsChange({ workMinutes: Math.max(1, Number(e.target.value) || 1) })}
                className="w-14"
              />
              <span>Break</span>
              <Input
                size="sm"
                type="number"
                min={1}
                max={180}
                value={String(prefs.breakMinutes)}
                onChange={(e) => onPrefsChange({ breakMinutes: Math.max(1, Number(e.target.value) || 1) })}
                className="w-14"
              />
            </div>
            <label className="mt-2 flex cursor-pointer items-center gap-2 font-sans text-sm text-muted-foreground">
              <input type="checkbox" checked={pomodoro} onChange={onTogglePomodoro} />
              Pomodoro rhythm
            </label>
            <button
              type="button"
              onClick={() => dispatchOpenSettings({ section: "focus" })}
              className="mt-2 font-sans text-2xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              More in Settings → Focus
            </button>
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

// ── formatting ────────────────────────────────────────────────────────────────

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
