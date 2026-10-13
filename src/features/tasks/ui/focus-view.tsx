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
import { Ellipsis, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { CompleteToggle } from "../../../components/ui/complete-toggle";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { IconButton } from "../../../components/ui/icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { type FocusPrefs, useFocusPrefs } from "../../../lib/focus-prefs";
import type { ModuoRuntime } from "../../../lib/runtime.types";
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
import { dispatchOpenSettings } from "../../settings/settings-events";
import { doneLineText, focusLineup } from "../focus-screen";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Task } from "../model";
import { FocusEmptyState } from "./focus-empty-state";
import { FOCUS_PILL, NowCard, TIMER_LABELS } from "./focus-now-card";
import { UpNext } from "./focus-up-next";

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
  // Opening Focus shows Now, unless the task already open is lined up here (a
  // link to it); a task opened in another view doesn't follow you in.
  const shownNowRef = useRef<string | null>(null);
  const queuedRef = useRef(api.queuedTaskIds);
  useLayoutEffect(() => {
    queuedRef.current = api.queuedTaskIds;
  });
  useEffect(() => {
    const prev = shownNowRef.current;
    const next = now?.id ?? null;
    shownNowRef.current = next;
    if (!next || next.startsWith("tmp-")) return;
    const keep =
      selectedTaskId !== null &&
      selectedTaskId !== prev &&
      (prev !== null || queuedRef.current.has(selectedTaskId));
    if (!keep) onSelectTask(next);
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
        <IconButton icon={Ellipsis} label="Focus options" tooltip={null} />
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
                className="pl-12"
              >
                Count down the estimate
              </DropdownMenuCheckboxItem>
              <DropdownMenuRadioItem value="pomodoro">Pomodoro</DropdownMenuRadioItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="pl-12">
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
        <DropdownMenuItem onSelect={() => onShowDone(!showDone)}>
          {showDone ? "Hide what’s done this session" : "Show what’s done this session"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* Alone at the bottom, far from Pause (62); "Focus stopped · Undo" for 10 s. */}
        <DropdownMenuItem disabled={!canStop} onSelect={() => stopFocusWithUndo()}>
          Stop
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
          className={FOCUS_PILL}
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
