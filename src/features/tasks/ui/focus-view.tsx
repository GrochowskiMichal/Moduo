// Focus, the screen (TV-F7, specs/tasks-v3.md §7; REPLAN 61–66, 62a, 63, 65a;
// prototype round-2a frames 1–3). The sidebar's Focus opens it; it replaces
// the old "Plan · Focus" switch and its Execute view.
//
//   Focus                                   [Focus 18:40]  ⋯     ← header: the name, Pomodoro's pill, ⋯
//   ┌ ● Website › Launch · Due Thu                 [⏸ 18:02 of ~45m] ┐
//   │ Draft the launch announcement                                    │  ← the Now card
//   │ description (folded) · references as chips · subtasks            │
//   └ [Done ⏎] [Skip S]                                                ┘
//   Up next · 4 · ~1h                                                  ← project dividers, numbered rows
//   2 done · 1h 12m · Show                                             ← the done line
//
// Everything about time goes through the one engine (`features/focus/timer.ts`,
// TV-F6): Start is "Focus on this" for the Now task, the pill pauses, Stop sits
// in ⋯ with "Focus stopped · Undo", leaving the view never stops a session.
// The parts that tick every second (the pills, the done line's time, "while you
// were away") are their own small components, so the card and Up next don't
// redraw with the clock. With nothing lined up the screen teaches the three
// ways in (call 66): Q, ⇧F, and today's scheduled tasks as real rows.
//
// Left for TV-F8 (REPLAN 57, 59a, 64, 10, 72a): "Arrange by project", the
// along-the-way offer between tasks, the meeting divider, the usual pace, and
// Hand off W with In flight.

import { type FocusTimerMode, isFocusTimerMode } from "@contracts/vocabularies";
import { closestCenter, type DraggableSyntheticListeners } from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Ellipsis, Pause, Play, Plus, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "../../../components/ui/button";
import { CompleteToggle } from "../../../components/ui/complete-toggle";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { IconButton } from "../../../components/ui/icon-button";
import { Kbd } from "../../../components/ui/kbd";
import { NavRowDot } from "../../../components/ui/nav-row";
import { SELECTED_ROW } from "../../../components/ui/selection";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { type FocusPrefs, useFocusPrefs } from "../../../lib/focus-prefs";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { formatDay, formatDuration, formatTime } from "../../../lib/time-format";
import { undoToast } from "../../../lib/undo-toast";
import { cn } from "../../../lib/utils";
import { formatFocusClock } from "../../focus/clock";
import { previewFocusInterval } from "../../focus/engine";
import { recordRunDone, useFocusRunState } from "../../focus/run";
import { stopFocusWithUndo } from "../../focus/stop-with-undo";
import {
  changeFocusTimer,
  focusOn,
  moveFocusTo,
  takeOverFocus,
  toggleFocusPause,
  useFocusTaskState,
  useFocusTimer,
} from "../../focus/timer";
import { FocusAwayPrompt } from "../../focus/ui/away-prompt";
import { TaskClaimMark } from "../../focus/ui/claim-mark";
import { dispatchOpenSettings } from "../../settings/settings-events";
import { useEntityHub } from "../../spine/hooks/use-entity-hub";
import { Reference } from "../../spine/references/ui/reference";
import { EntityRichText } from "../../spine/ui/entity-rich-text";
import {
  doneLineText,
  focusLineup,
  pillReading,
  type ScheduledToday,
  scheduledToday,
  upNextLines,
  upNextSummary,
} from "../focus-screen";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import { estimateOf, type Task } from "../model";
import { bucketDotColor } from "../sidebar";
import { nowOn, useToday } from "../use-today";
import {
  DndBoundary,
  type DragActivatorRef,
  SortableTask,
  useTaskDndSensors,
} from "./dnd/task-dnd";
import { PriorityMark } from "./level-icons";

/** Pomodoro lengths offered in ⋯ (work / break minutes); others in Settings. */
const POMODORO_PRESETS: readonly { work: number; rest: number }[] = [
  { work: 25, rest: 5 },
  { work: 50, rest: 10 },
  { work: 90, rest: 15 },
];

type Props = {
  api: TasksModuleApi;
  workspaceId: string;
  runtime: ModuoRuntime | null;
  canEdit: boolean;
  /** "Inbox", a project's name, or "Private project". */
  bucketNameById: (id: string) => string;
  /** The page's selection (the panel's Details). */
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  /** Open a task's own details on top of the panel ("← item", call 65a). */
  onOpenTask: (id: string) => void;
  /** The task the panel's stack shows on top (a subtask opened from the card). */
  panelTaskId: string | null;
  /** New, at the top of Up next (call 90). */
  onRequestCapture: () => void;
  /** The page's one DndContext (DF-22) or, standalone, this view's own. */
  dndMode?: "internal" | "external";
};

export function FocusView({
  api,
  workspaceId,
  runtime,
  canEdit,
  bucketNameById,
  selectedTaskId,
  onSelectTask,
  onOpenTask,
  panelTaskId,
  onRequestCapture,
  dndMode = "external",
}: Props) {
  const focus = useFocusTaskState();
  const { run, ended } = useFocusRunState();
  const { prefs, setPrefs } = useFocusPrefs();
  const [showDone, setShowDone] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const taskById = useMemo(() => new Map(api.tasks.map((t) => [t.id, t])), [api.tasks]);
  // A session in this workspace (here or on another of my devices).
  const here = focus.active && focus.workspaceId === workspaceId;
  const sessionTask = here && focus.taskId ? (taskById.get(focus.taskId) ?? null) : null;
  const { now, upNext } = useMemo(
    () => focusLineup(api.queuedTasks, sessionTask),
    [api.queuedTasks, sessionTask],
  );
  // The session is on the card (else the card offers Start).
  const onNow = here && !!now && focus.taskId === now.id;
  const refOf = api.focusRefOf;

  // The panel follows Now (its Details), until you open something else: a row
  // in Up next or a scheduled task. A subtask stacks on top instead (65a).
  const shownNowRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = shownNowRef.current;
    const next = now?.id ?? null;
    shownNowRef.current = next;
    if (!next || next.startsWith("tmp-")) return;
    if (selectedTaskId === null || selectedTaskId === prev) onSelectTask(next);
  }, [now?.id, selectedTaskId, onSelectTask]);

  // ── the session's verbs (Start · Pause · Done · Stop) ──────────────────────
  const start = useCallback(() => {
    if (!now || !canEdit) return;
    const ref = refOf(now.id);
    if (!ref) return;
    focusOn(ref, { timer: prefs.timer, resolveTask: refOf });
  }, [now, canEdit, refOf, prefs.timer]);

  const done = useCallback(() => {
    if (!now || !canEdit) return;
    const next = firstReal(upNext);
    api.markDone(now.id);
    if (!onNow) return;
    // Counted in "n done" by the device that runs the clock: this one, now.
    takeOverFocus(refOf);
    recordRunDone(now.id);
    // The last one ends the session (62: "a session ends by itself when Up
    // next runs out"); the done line keeps its numbers.
    moveFocusTo(next ? refOf(next.id) : null, refOf);
  }, [now, canEdit, upNext, api, onNow, refOf]);

  const skip = useCallback(() => {
    if (!now || !canEdit) return;
    const next = firstReal(upNext);
    if (api.queuedTaskIds.has(now.id)) api.moveQueuedToEnd(now.id);
    else api.addToQueue(now.id, "end");
    if (onNow && next) moveFocusTo(refOf(next.id), refOf);
  }, [now, canEdit, upNext, api, onNow, refOf]);

  const changeTimer = useCallback(
    (timer: FocusTimerMode) => {
      // The menu changes it everywhere (63): the default and the session.
      setPrefs({ timer });
      changeFocusTimer(timer, refOf);
    },
    [setPrefs, refOf],
  );

  // ── keys: ⏎ Done · S Skip · C new at the top of Up next · ⇧F on a row ──────
  const keys = useRef({ done, skip, onRequestCapture, api, canEdit });
  useLayoutEffect(() => {
    keys.current = { done, skip, onRequestCapture, api, canEdit };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target instanceof Element ? e.target : null;
      const root = rootRef.current;
      // Ours only from the screen itself, or from nowhere in particular.
      if (target && target !== document.body && !root?.contains(target)) return;
      if (target && isTypingTarget(target)) return;
      if (target?.closest('[role="menu"],[role="dialog"],[role="listbox"]')) return;
      const k = keys.current;
      if (e.shiftKey && e.key.toLowerCase() === "f") {
        // ⇧F on a subtask or an Up next row: it becomes the Now card (65a).
        const id = target?.closest<HTMLElement>("[data-focus-task]")?.dataset.focusTask;
        if (!id || !k.canEdit) return;
        e.preventDefault();
        k.api.focusOnTask(id);
        return;
      }
      if (e.shiftKey) return;
      // A focused button keeps its own Enter.
      const onControl = !!target?.closest("button,a,[role='button'],[role='checkbox']");
      if (e.key === "Enter" && !onControl) {
        e.preventDefault();
        k.done();
      } else if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        k.skip();
      } else if (e.key.toLowerCase() === "c" && k.canEdit) {
        e.preventDefault();
        k.onRequestCapture();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── what this session finished ("2 done · Show") ───────────────────────────
  const sessionRun = run && run.workspaceId === workspaceId ? run : null;
  const endedRun = !sessionRun && ended && ended.workspaceId === workspaceId ? ended : null;
  const doneIds = useMemo(() => {
    const ids = sessionRun?.doneTaskIds ?? endedRun?.doneTaskIds;
    if (ids) return ids;
    // No session yet: what you checked off here since the list loaded.
    return api.queuedTasks.filter((t) => t.status === "done").map((t) => t.id);
  }, [sessionRun, endedRun, api.queuedTasks]);
  const timed = (sessionRun?.mode ?? endedRun?.mode ?? prefs.timer) !== "off";

  if (!api.loaded) return <FocusSkeleton />;

  const timerMode: FocusTimerMode = here && focus.timer ? focus.timer : prefs.timer;
  const header = (
    <div className="mb-3 flex shrink-0 items-center gap-2">
      <h1 className="min-w-0 flex-1 truncate font-display text-lg text-foreground">Focus</h1>
      {here && focus.timer === "pomodoro" ? <PomodoroPill /> : null}
      <FocusMenu
        timer={timerMode}
        prefs={prefs}
        onTimer={changeTimer}
        onPrefs={setPrefs}
        showDone={showDone}
        onShowDone={setShowDone}
        canStop={focus.active}
      />
    </div>
  );

  const doneLine =
    doneIds.length > 0 ? (
      <DoneLine
        count={doneIds.length}
        timed={timed}
        endedSeconds={endedRun?.focusedSeconds ?? null}
        live={!!sessionRun}
        shown={showDone}
        onToggle={() => setShowDone((v) => !v)}
      />
    ) : null;
  const doneList =
    showDone && doneIds.length > 0 ? (
      <DoneList ids={doneIds} taskById={taskById} bucketNameById={bucketNameById} />
    ) : null;

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col" data-slot="focus-view">
      {header}
      <div className="pane-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 pb-6">
          {now ? (
            <>
              <NowCard
                task={now}
                api={api}
                runtime={runtime}
                workspaceId={workspaceId}
                canEdit={canEdit}
                bucketNameById={bucketNameById}
                onNow={onNow}
                timer={timerMode}
                countdown={prefs.countdownEstimate}
                panelTaskId={panelTaskId}
                onOpenTask={onOpenTask}
                onStart={start}
                onDone={done}
                onSkip={skip}
              />
              <UpNext
                upNext={upNext}
                nowId={api.queuedTaskIds.has(now.id) ? now.id : null}
                api={api}
                canEdit={canEdit}
                bucketNameById={bucketNameById}
                selectedTaskId={selectedTaskId}
                onSelectTask={onSelectTask}
                dndMode={dndMode}
              />
              {doneLine}
              {doneList}
            </>
          ) : (
            <>
              {doneLine}
              {doneList}
              <FocusEmptyState
                api={api}
                canEdit={canEdit}
                bucketNameById={bucketNameById}
                selectedTaskId={selectedTaskId}
                onSelectTask={onSelectTask}
                onRequestCapture={onRequestCapture}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── the header's ⋯ (63) ─────────────────────────────────────────────────────

function FocusMenu({
  timer,
  prefs,
  onTimer,
  onPrefs,
  showDone,
  onShowDone,
  canStop,
}: {
  timer: FocusTimerMode;
  prefs: FocusPrefs;
  onTimer: (timer: FocusTimerMode) => void;
  onPrefs: (patch: Partial<FocusPrefs>) => void;
  showDone: boolean;
  onShowDone: (show: boolean) => void;
  canStop: boolean;
}) {
  const lengths = `${prefs.workMinutes} / ${prefs.breakMinutes}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton icon={Ellipsis} label="Focus options" tooltip="Timer · Stop · …" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            Timer
            <span className="ml-auto pl-3 font-sans text-xs text-muted-foreground">
              {TIMER_LABELS[timer]}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-60">
            <DropdownMenuRadioGroup
              value={timer}
              onValueChange={(value) => {
                if (isFocusTimerMode(value)) onTimer(value);
              }}
            >
              <DropdownMenuRadioItem value="per_task">Per task</DropdownMenuRadioItem>
              <DropdownMenuCheckboxItem
                checked={prefs.countdownEstimate}
                disabled={timer !== "per_task"}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(checked) => onPrefs({ countdownEstimate: checked === true })}
                className="pl-8"
              >
                Count down the estimate
              </DropdownMenuCheckboxItem>
              <DropdownMenuRadioItem value="pomodoro">Pomodoro</DropdownMenuRadioItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="pl-8">
                  Lengths
                  <span className="ml-auto pl-3 font-sans text-xs tabular-nums text-muted-foreground">
                    {lengths}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={lengths}
                    onValueChange={(value) => {
                      const preset = POMODORO_PRESETS.find(
                        (p) => `${p.work} / ${p.rest}` === value,
                      );
                      if (!preset) return;
                      const patch = { workMinutes: preset.work, breakMinutes: preset.rest };
                      onPrefs(patch);
                      previewFocusInterval({ ...prefs, ...patch });
                    }}
                  >
                    {POMODORO_PRESETS.map((p) => (
                      <DropdownMenuRadioItem
                        key={p.work}
                        value={`${p.work} / ${p.rest}`}
                        className="tabular-nums"
                      >
                        {p.work} / {p.rest} min
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() =>
                      // After the menu closes: Settings takes focus (ui.md gotcha).
                      window.setTimeout(() => dispatchOpenSettings({ section: "focus" }), 0)
                    }
                  >
                    Other lengths…
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuRadioItem value="off">Off</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuCheckboxItem
          checked={showDone}
          onCheckedChange={(checked) => onShowDone(checked === true)}
        >
          Show what’s done this session
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!canStop} onSelect={() => stopFocusWithUndo()}>
          Stop
          <DropdownMenuShortcut>Undo 10 s</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const TIMER_LABELS: Record<FocusTimerMode, string> = {
  per_task: "Per task",
  pomodoro: "Pomodoro",
  off: "Off",
};

// ── the pills (one number per job, 62) ──────────────────────────────────────

const pillClass =
  "inline-flex h-(--ctrl-h-sm) shrink-0 items-center gap-1.5 rounded-full border border-hairline px-2.5 font-sans text-xs tabular-nums text-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

/** Pomodoro's rhythm in the header, beside ⋯ ("Focus 18:40", "Break 4:12"). */
function PomodoroPill() {
  const t = useFocusTimer();
  if (!t.active || t.timer !== "pomodoro") return null;
  const phase = t.phase === "break" ? (t.longBreak ? "Long break" : "Break") : "Focus";
  const clock = formatFocusClock(t.bigClock);
  const where = t.elsewhere ? " · on your other device" : "";
  const action = t.running ? "Pause" : "Resume";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={pillClass}
          aria-label={`${action} · ${phase} ${clock}${where}`}
          onClick={() => toggleFocusPause()}
          data-slot="focus-pomodoro-pill"
        >
          {t.running ? (
            <Pause className="size-icon-xs" aria-hidden />
          ) : (
            <Play className="size-icon-xs" aria-hidden />
          )}
          {t.running ? (
            <span>
              {phase} {clock}
            </span>
          ) : (
            <span>
              Paused <span className="text-muted-foreground">·</span> {clock}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {action}
        {where}
      </TooltipContent>
    </Tooltip>
  );
}

/** The Per task pill on the Now card: "⏸ 18:02 of ~45m", "▶ Paused · 18:02". */
function TaskPill({ task, countdown }: { task: Task; countdown: boolean }) {
  const t = useFocusTimer();
  if (!t.active || t.timer !== "per_task" || t.taskId !== task.id) return null;
  const reading = pillReading({
    sitting: t.taskSeconds,
    total: task.timeSpentSeconds + t.accrued,
    estimateMinutes: estimateOf(task),
    countdown,
  });
  const action = t.running ? "Pause" : "Resume";
  const where = t.elsewhere ? " · on your other device" : "";
  const unsaved = t.unsaved ? " · some time isn’t saved yet, retrying" : "";
  const text = reading.note ? `${reading.clock} ${reading.note}` : reading.clock;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={pillClass}
          aria-label={`${action} · ${t.running ? text : `Paused · ${reading.clock}`}${where}${unsaved}`}
          onClick={() => toggleFocusPause()}
          data-slot="focus-task-pill"
        >
          {t.running ? (
            <Pause className="size-icon-xs" aria-hidden />
          ) : (
            <Play className="size-icon-xs" aria-hidden />
          )}
          {t.running ? (
            <span>
              {reading.clock}
              {reading.note ? <span className="text-muted-foreground"> {reading.note}</span> : null}
            </span>
          ) : (
            <span>
              Paused <span className="text-muted-foreground">·</span> {reading.clock}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {action}
        {where}
        {unsaved}
      </TooltipContent>
    </Tooltip>
  );
}

/** "While you were away" waits for an answer on the card (TV-F1). */
function AwayLine() {
  const t = useFocusTimer();
  if (!t.away) return null;
  return <FocusAwayPrompt away={t.away} className="mt-1" />;
}

// ── the Now card ────────────────────────────────────────────────────────────

function NowCard({
  task,
  api,
  runtime,
  workspaceId,
  canEdit,
  bucketNameById,
  onNow,
  timer,
  countdown,
  panelTaskId,
  onOpenTask,
  onStart,
  onDone,
  onSkip,
}: {
  task: Task;
  api: TasksModuleApi;
  runtime: ModuoRuntime | null;
  workspaceId: string;
  canEdit: boolean;
  bucketNameById: (id: string) => string;
  /** The session is on this task. */
  onNow: boolean;
  timer: FocusTimerMode;
  countdown: boolean;
  panelTaskId: string | null;
  onOpenTask: (id: string) => void;
  onStart: () => void;
  onDone: () => void;
  onSkip: () => void;
}) {
  const today = useToday();
  const project = api.buckets.find((b) => b.id === task.bucketId) ?? null;
  const parent = task.parentId ? (api.tasks.find((t) => t.id === task.parentId) ?? null) : null;
  const section = !parent
    ? (api.sections.find((s) => s.id === task.sectionId && s.projectId === task.bucketId) ?? null)
    : null;
  const due = task.dueDate ? formatDay(task.dueDate, nowOn(today)) : null;
  const blocked = api.blockedTaskIds.has(task.id)
    ? (api.blockersByTask.get(task.id) ?? []).filter((b) => b.status !== "done").length
    : 0;
  const subtasks = api.subtasksByParent.get(task.id) ?? [];
  const saving = task.id.startsWith("tmp-");

  return (
    <section
      aria-label="Now"
      data-slot="focus-now"
      data-focus-task={task.id}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card px-5 py-4"
    >
      <div className="flex min-h-(--ctrl-h-sm) items-center gap-2">
        <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 font-sans text-xs text-muted-foreground">
          <NavRowDot color={bucketDotColor(project ?? {})} className="size-1.5" />
          <span className="min-w-0 break-words">{bucketNameById(task.bucketId)}</span>
          {parent || section ? (
            <>
              <span aria-hidden className="text-subtle-foreground">
                ›
              </span>
              <span className="min-w-0 break-words">
                {parent ? parent.title || "Untitled" : section?.name}
              </span>
            </>
          ) : null}
          {due ? (
            <>
              <span aria-hidden className="text-subtle-foreground">
                ·
              </span>
              <span className="whitespace-nowrap">Due {due}</span>
            </>
          ) : null}
          {blocked > 0 ? (
            <>
              <span aria-hidden className="text-subtle-foreground">
                ·
              </span>
              <span>Blocked by {blocked === 1 ? "1 task" : `${blocked} tasks`}</span>
            </>
          ) : null}
          {task.priority === "high" ? <PriorityMark level="high" /> : null}
        </p>
        <TaskClaimMark workspaceId={task.workspaceId} taskId={task.id} />
        {onNow ? (
          timer === "per_task" ? (
            <TaskPill task={task} countdown={countdown} />
          ) : null
        ) : canEdit ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={pillClass}
                onClick={onStart}
                disabled={saving}
                aria-label={`Start · ${TIMER_LABELS[timer]}`}
                data-slot="focus-start"
              >
                <Play className="size-icon-xs" aria-hidden />
                Start
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {timer === "off"
                ? "Start · the timer is off, nothing is recorded"
                : timer === "pomodoro"
                  ? "Start · Pomodoro"
                  : "Start · times this task"}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-display text-2xl leading-snug text-foreground break-words">
          {task.title || "Untitled"}
        </h2>
        {task.description ? <FoldedDescription html={task.description} /> : null}
        {runtime ? (
          <NowReferences runtime={runtime} workspaceId={workspaceId} taskId={task.id} />
        ) : null}
      </div>

      {subtasks.length > 0 ? (
        <SubtaskChecklist
          subtasks={subtasks}
          canEdit={canEdit}
          runtime={runtime}
          workspaceId={workspaceId}
          panelTaskId={panelTaskId}
          onOpen={onOpenTask}
          onToggle={api.toggleDone}
        />
      ) : null}

      {onNow ? <AwayLine /> : null}

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" onClick={onDone} disabled={saving}>
            Done
            <Kbd className="border-primary-foreground/30 bg-transparent text-primary-foreground">
              ⏎
            </Kbd>
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="secondary" onClick={onSkip} disabled={saving}>
                Skip
                <Kbd className="bg-transparent">S</Kbd>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Moves it to the end of Up next</TooltipContent>
          </Tooltip>
        </div>
      ) : null}
    </section>
  );
}

/** About six lines, then "Show more" (call 56's fold, read-only here). */
function FoldedDescription({ html }: { html: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [folds, setFolds] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the text is the cue
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || expanded) return;
    setFolds(box.scrollHeight > box.clientHeight + 1);
  }, [html, expanded]);
  return (
    <div>
      <div
        ref={boxRef}
        className={cn(
          "font-sans text-sm leading-relaxed text-muted-foreground",
          !expanded && "max-h-36 overflow-hidden",
          !expanded && folds && "mask-b-from-60%",
        )}
      >
        <EntityRichText html={html} />
      </div>
      {folds || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 rounded-sm font-sans text-xs text-muted-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

/** What the task links to, as chips that open in the panel (RF-1, call 55). */
function NowReferences({
  runtime,
  workspaceId,
  taskId,
}: {
  runtime: ModuoRuntime;
  workspaceId: string;
  taskId: string;
}) {
  const focusRef = useMemo(() => ({ type: "task", id: taskId }), [taskId]);
  const hub = useEntityHub(runtime, workspaceId, focusRef);
  const rows = hub.sections.flatMap((s) => s.rows).filter((r) => !r.tombstoned);
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-slot="focus-references">
      {rows.slice(0, 8).map((row) => (
        <Reference
          key={row.link.id}
          type={row.other.type}
          id={row.other.id}
          display="chip"
          fallbackLabel={row.title}
        />
      ))}
      {rows.length > 8 ? (
        <span className="font-sans text-xs text-subtle-foreground">+{rows.length - 8} more</span>
      ) : null}
    </div>
  );
}

/** Small marks for what a subtask holds: "notes · 1 file · 2 links" (65a). */
function useSubtaskMarks(
  runtime: ModuoRuntime | null,
  workspaceId: string,
  subtaskIds: readonly string[],
): Map<string, { files: number; links: number }> {
  const [marks, setMarks] = useState(() => new Map<string, { files: number; links: number }>());
  const key = subtaskIds.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the ids' key is the cue
  useEffect(() => {
    if (!runtime || subtaskIds.length === 0) return;
    let alive = true;
    // Best effort, a handful at most: a card's subtasks, never a list's.
    const ids = subtaskIds.filter((id) => !id.startsWith("tmp-")).slice(0, 20);
    void Promise.all(
      ids.map(async (id) => {
        const [links, files] = await Promise.all([
          runtime.spine
            .listLinks({ workspaceId, entityType: "task", entityId: id })
            .then((l) => l.length)
            .catch(() => 0),
          runtime.attachments
            .listForEntity({ workspaceId, entityType: "task", entityId: id })
            .then((f) => f.length)
            .catch(() => 0),
        ]);
        return [id, { files, links }] as const;
      }),
    ).then((entries) => {
      if (alive) setMarks(new Map(entries));
    });
    return () => {
      alive = false;
    };
  }, [runtime, workspaceId, key]);
  return marks;
}

function marksText(task: Task, counts: { files: number; links: number } | undefined): string {
  const parts: string[] = [];
  if (task.description.trim()) parts.push("notes");
  if (counts?.files) parts.push(counts.files === 1 ? "1 file" : `${counts.files} files`);
  if (counts?.links) parts.push(counts.links === 1 ? "1 link" : `${counts.links} links`);
  return parts.join(" · ");
}

/**
 * The focused task's subtasks, an unordered checklist (65a): click one and its
 * own details open in the panel; check it off here or there; ⇧F on it makes it
 * the Now card. Finishing the last one doesn't finish the parent.
 */
function SubtaskChecklist({
  subtasks,
  canEdit,
  runtime,
  workspaceId,
  panelTaskId,
  onOpen,
  onToggle,
}: {
  subtasks: Task[];
  canEdit: boolean;
  runtime: ModuoRuntime | null;
  workspaceId: string;
  panelTaskId: string | null;
  onOpen: (id: string) => void;
  onToggle: (task: Task) => void;
}) {
  const done = subtasks.filter((s) => s.status === "done").length;
  const marks = useSubtaskMarks(
    runtime,
    workspaceId,
    subtasks.map((s) => s.id),
  );
  return (
    <div className="flex flex-col gap-1" data-slot="focus-subtasks">
      <p className="font-sans text-xs text-muted-foreground">
        Subtasks{" "}
        <span className="tabular-nums text-subtle-foreground">
          {done}/{subtasks.length}
        </span>
      </p>
      <ul className="flex flex-col">
        {subtasks.map((st) => {
          const isDone = st.status === "done";
          const open = panelTaskId === st.id;
          const mark = marksText(st, marks.get(st.id));
          return (
            <li
              key={st.id}
              data-focus-task={st.id}
              className={cn(
                "group flex min-h-(--row-h) items-center gap-2 rounded-md px-1.5",
                open ? SELECTED_ROW : "hover:bg-state-hover",
              )}
            >
              <CompleteToggle done={isDone} disabled={!canEdit} onToggle={() => onToggle(st)} />
              <button
                type="button"
                onClick={() => onOpen(st.id)}
                aria-label={`${st.title || "Untitled"}: open its details`}
                aria-current={open ? "true" : undefined}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 rounded-sm py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                )}
              >
                <span
                  className={cn(
                    "min-w-0 flex-1 break-words font-sans text-sm",
                    isDone ? "text-muted-foreground line-through" : "text-foreground",
                  )}
                >
                  {st.title || "Untitled"}
                </span>
                {mark ? (
                  <span className="shrink-0 font-sans text-xs text-subtle-foreground">{mark}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Up next ─────────────────────────────────────────────────────────────────

function UpNext({
  upNext,
  nowId,
  api,
  canEdit,
  bucketNameById,
  selectedTaskId,
  onSelectTask,
  dndMode,
}: {
  upNext: Task[];
  /** Now, when it's lined up too: a move to the top of Up next goes after it. */
  nowId: string | null;
  api: TasksModuleApi;
  canEdit: boolean;
  bucketNameById: (id: string) => string;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  dndMode: "internal" | "external";
}) {
  const sensors = useTaskDndSensors();
  const ids = useMemo(() => upNext.map((t) => t.id), [upNext]);
  const lines = useMemo(() => upNextLines(upNext), [upNext]);
  const projects = useMemo(() => new Map(api.buckets.map((b) => [b.id, b])), [api.buckets]);

  // A move inside Up next keeps Now where it is (it's never the drop's anchor).
  const reorder = useCallback(
    (previous: string[], next: string[], label: string) => {
      const full = (list: string[]) => (nowId ? [nowId, ...list] : list);
      api.reorderQueue(full(next), () =>
        undoToast(label, { onUndo: () => api.reorderQueue(full(previous)) }),
      );
    },
    [api, nowId],
  );
  const move = (id: string, delta: 1 | -1) => {
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    reorder(ids, arrayMove(ids, from, to), delta < 0 ? "Moved up" : "Moved down");
  };

  if (upNext.length === 0) {
    return (
      <p className="px-1 font-sans text-sm text-muted-foreground">
        Last one. Nothing else is lined up.
      </p>
    );
  }

  return (
    <section aria-label="Up next" className="flex flex-col gap-1" data-slot="focus-up-next">
      <p className="px-1 font-sans text-sm text-foreground">
        Up next <span className="tabular-nums text-muted-foreground">{upNextSummary(upNext)}</span>
      </p>
      <DndBoundary
        dndMode={dndMode}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={(e) => {
          const { active, over } = e;
          if (!over || active.id === over.id) return;
          const from = ids.indexOf(String(active.id));
          const to = ids.indexOf(String(over.id));
          if (from < 0 || to < 0) return;
          reorder(ids, arrayMove(ids, from, to), "Moved");
        }}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ol className="flex flex-col">
            {lines.map((line) =>
              line.kind === "divider" ? (
                <li
                  key={line.key}
                  aria-hidden
                  className="flex items-center gap-2 px-1.5 pt-2 pb-0.5 font-sans text-xs text-muted-foreground"
                >
                  <NavRowDot
                    color={bucketDotColor(projects.get(line.projectId) ?? {})}
                    className="size-1.5"
                  />
                  <span className="shrink-0">{bucketNameById(line.projectId)}</span>
                  <span className="h-px flex-1 bg-hairline" />
                </li>
              ) : (
                <SortableTask
                  key={line.key}
                  id={line.task.id}
                  from="queue"
                  disabled={!canEdit}
                  render={({ dragListeners, dragActivatorRef }) => (
                    <UpNextRow
                      task={line.task}
                      number={line.number}
                      parentTitle={
                        line.task.parentId
                          ? (api.tasks.find((t) => t.id === line.task.parentId)?.title ?? null)
                          : null
                      }
                      selected={selectedTaskId === line.task.id}
                      canEdit={canEdit}
                      onSelect={() => onSelectTask(line.task.id)}
                      onFocusOn={() => api.focusOnTask(line.task.id)}
                      onRemove={() => {
                        const id = line.task.id;
                        api.removeFromQueue(id);
                        undoToast("Removed from Focus", { onUndo: () => api.addToQueue(id) });
                      }}
                      onMove={(delta) => move(line.task.id, delta)}
                      dragListeners={dragListeners}
                      dragActivatorRef={dragActivatorRef}
                    />
                  )}
                />
              ),
            )}
          </ol>
        </SortableContext>
      </DndBoundary>
    </section>
  );
}

function UpNextRow({
  task,
  number,
  parentTitle,
  selected,
  canEdit,
  onSelect,
  onFocusOn,
  onRemove,
  onMove,
  dragListeners,
  dragActivatorRef,
}: {
  task: Task;
  number: number;
  parentTitle: string | null;
  selected: boolean;
  canEdit: boolean;
  onSelect: () => void;
  onFocusOn: () => void;
  onRemove: () => void;
  onMove: (delta: 1 | -1) => void;
  dragListeners: DraggableSyntheticListeners;
  dragActivatorRef: DragActivatorRef;
}) {
  const est = estimateOf(task);
  return (
    <li
      ref={dragActivatorRef}
      {...(canEdit ? dragListeners : {})}
      data-task-id={task.id}
      data-focus-task={task.id}
      className={cn(
        "group flex min-h-(--row-h) items-center gap-2 rounded-md px-1.5",
        selected ? SELECTED_ROW : "hover:bg-state-hover",
      )}
    >
      <span className="w-5 shrink-0 text-right font-sans text-xs tabular-nums text-subtle-foreground">
        {number}
      </span>
      <button
        type="button"
        onClick={onSelect}
        onKeyDown={(e) => {
          if (!canEdit || !e.altKey || !e.shiftKey) return;
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            onMove(e.key === "ArrowUp" ? -1 : 1);
          }
        }}
        aria-current={selected ? "true" : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-sm py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="min-w-0 flex-1 truncate font-sans text-sm text-foreground">
          {task.title || "Untitled"}
          {parentTitle ? (
            <span className="text-subtle-foreground"> · ↳ {parentTitle || "Untitled"}</span>
          ) : null}
        </span>
      </button>
      <TaskClaimMark workspaceId={task.workspaceId} taskId={task.id} />
      {est ? (
        <span className="shrink-0 font-sans text-xs tabular-nums text-muted-foreground">
          ~{formatDuration(est)}
        </span>
      ) : null}
      {canEdit ? (
        <span className="flex shrink-0 items-center opacity-0 transition-opacity duration-(--motion-fade) ease-(--ease-out) group-hover:opacity-100 has-focus-visible:opacity-100">
          <IconButton
            icon={Play}
            label="Focus on this"
            tooltip={
              <>
                Focus on this <Kbd>⇧F</Kbd>
              </>
            }
            onClick={(e) => {
              e.stopPropagation();
              onFocusOn();
            }}
          />
          <IconButton
            icon={X}
            label="Remove from Focus"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          />
        </span>
      ) : null}
    </li>
  );
}

// ── the done line (62a: "2 done · 1h 12m · Show") ───────────────────────────

function DoneLine({
  count,
  timed,
  endedSeconds,
  live,
  shown,
  onToggle,
}: {
  count: number;
  timed: boolean;
  /** The ended session's focused time; null while one runs. */
  endedSeconds: number | null;
  live: boolean;
  shown: boolean;
  onToggle: () => void;
}) {
  return (
    <p className="flex items-center gap-1.5 px-1 font-sans text-xs tabular-nums text-muted-foreground">
      {live ? (
        <LiveDoneText count={count} timed={timed} />
      ) : (
        <span>{doneLineText({ done: count, seconds: endedSeconds ?? 0, timed })}</span>
      )}
      <span aria-hidden>·</span>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={shown}
        className="rounded-sm text-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {shown ? "Hide" : "Show"}
      </button>
    </p>
  );
}

function LiveDoneText({ count, timed }: { count: number; timed: boolean }) {
  const t = useFocusTimer();
  return <span>{doneLineText({ done: count, seconds: t.sessionSeconds, timed })}</span>;
}

function DoneList({
  ids,
  taskById,
  bucketNameById,
}: {
  ids: readonly string[];
  taskById: Map<string, Task>;
  bucketNameById: (id: string) => string;
}) {
  return (
    <ul className="flex flex-col px-1" aria-label="Done this session" data-slot="focus-done">
      {ids.map((id) => {
        const task = taskById.get(id);
        return (
          <li key={id} className="flex min-h-(--row-h) items-center gap-2">
            <CompleteToggle done disabled onToggle={() => {}} aria-label="Done" />
            <span className="min-w-0 flex-1 truncate font-sans text-sm text-muted-foreground line-through">
              {task ? task.title || "Untitled" : "A finished task"}
            </span>
            {task ? (
              <span className="shrink-0 font-sans text-xs text-subtle-foreground">
                {bucketNameById(task.bucketId)}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

// ── the empty state: three ways in (66) ─────────────────────────────────────

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
    "tasks" | "sessions" | "currentUserId" | "queuedTaskIds" | "addToQueue"
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
      <p className="font-display text-lg text-foreground">
        Line up what you’ll do next, then press Start.
      </p>
      <ul className="flex flex-col gap-1.5 font-sans text-sm text-muted-foreground">
        <li>
          Press <Kbd>Q</Kbd> on any task to add it here.
        </li>
        <li>
          Press <Kbd>⇧F</Kbd> on a task to focus on it alone.
        </li>
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
                  <IconButton icon={Plus} label="Add to Focus" onClick={() => lineUp([row])} />
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

function FocusSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy="true" data-slot="focus-view">
      <div className="mb-3 flex h-7 items-center">
        <h1 className="font-display text-lg text-foreground">Focus</h1>
      </div>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
        <div className="h-40 rounded-lg border border-border bg-card" />
        <div className="h-4 w-32 rounded-sm bg-muted" />
        <div className="h-4 w-48 rounded-sm bg-muted" />
      </div>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** The first task with a real id (one still saving can't take the clock). */
function firstReal(list: readonly Task[]): Task | null {
  return list.find((t) => !t.id.startsWith("tmp-")) ?? null;
}

function isTypingTarget(el: Element): boolean {
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}
