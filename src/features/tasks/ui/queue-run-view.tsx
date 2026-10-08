// The Queue view (TV-F2, specs/tasks-v2.md §3; comp §4): Focus is a state of
// the Queue, not a mode. With no run it's the line-up — numbered, drag to
// reorder, "Add to queue…", the capacity mirror, the stale-line prompt — and
// ▶ Start run (⌘↵). While a run is on it holds only Now and Up next: Done (⏎),
// Skip (to the end), ⋯ Remove / Do later / Open; Up next reorders, and "Do
// now" swaps a task in. The sidebar never changes.

import { closestCenter, type DragEndEvent, type DraggableSyntheticListeners } from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  Calendar,
  Check,
  ChevronDown,
  CornerDownLeft,
  GripVertical,
  Hash,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Timer,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "../../../components/ui/button";
import { CompleteToggle } from "../../../components/ui/complete-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { EmptyState } from "../../../components/ui/empty-state";
import { Eyebrow } from "../../../components/ui/eyebrow";
import { IconButton } from "../../../components/ui/icon-button";
import { Input } from "../../../components/ui/input";
import { Kbd } from "../../../components/ui/kbd";
import { MetaCount, MetaCounts } from "../../../components/ui/meta-count";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { SegmentedControl } from "../../../components/ui/segmented-control";
import { Toolbar } from "../../../components/ui/toolbar";
import { ENTITY_OPEN_EVENT } from "../../../lib/entity-open";
import { type FocusPrefs, useFocusPrefs } from "../../../lib/focus-prefs";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { cn } from "../../../lib/utils";
import { previewFocusInterval, useFocusSession } from "../../focus/engine";
import { useRunReading } from "../../focus/run";
import {
  capacityLabel,
  type FocusRunMode,
  formatClock,
  formatDuration,
  formatMinutes,
  lineUpCapacity,
  lineUpTouchedAt,
  staleLineUpDays,
} from "../../focus/run-model";
import { FocusAwayPrompt } from "../../focus/ui/away-prompt";
import { LiveDot } from "../../focus/ui/live-dot";
import { dispatchOpenSettings } from "../../settings/settings-events";
import { useEntityHub } from "../../spine/hooks/use-entity-hub";
import { resolveEntityIcon } from "../../spine/icon-map";
import { EntityRichText } from "../../spine/ui/entity-rich-text";
import { useAssignees } from "../assignees";
import { formatDue, formatScheduled, PRIORITY_LABELS } from "../helpers";
import type { QueueRunApi } from "../hooks/use-queue-run";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Task } from "../model";
import { AssigneeAvatar } from "./assignee-avatar";
import {
  DndBoundary,
  type DragActivatorRef,
  SortableTask,
  useTaskDndSensors,
} from "./dnd/task-dnd";
import { PriorityIcon } from "./level-icons";
import { ClaimAvatar, useQueueClaim } from "./queue-toggle";

// "Keep all" holds for the rest of the session even before the next load
// brings the touched rows (per workspace).
const lineUpKeptAt = new Map<string, number>();

/** Test seam: forget this session's "Keep all"s. */
export function __resetLineUpKeptForTest(): void {
  lineUpKeptAt.clear();
}

type Props = {
  api: TasksModuleApi;
  queueRun: QueueRunApi;
  workspaceId: string;
  runtime: ModuoRuntime | null;
  /** Name of another workspace whose run is on (Start run here ends it). */
  otherRunWorkspaceName: string | null;
  bucketNameById: (id: string) => string;
  parentTitleFor: (task: Task) => string | null;
  blockedNoteFor: (task: Task) => string | null;
  canEdit: boolean;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  /** Open capture (in the Queue it adds to my queue by default). */
  onRequestCapture: () => void;
  /** Start another surface's drag (dnd-kit) — the page owns one context. */
  dndMode?: "internal" | "external";
};

export function QueueRunView({
  api,
  queueRun,
  workspaceId,
  runtime,
  otherRunWorkspaceName,
  bucketNameById,
  parentTitleFor,
  blockedNoteFor,
  canEdit,
  selectedTaskId,
  onSelectTask,
  onRequestCapture,
  dndMode = "external",
}: Props) {
  const { prefs, setPrefs } = useFocusPrefs();
  const running = queueRun.runHere && queueRun.run !== null;
  const addRef = useRef<HTMLInputElement>(null);

  // Keys: ⌘↵ starts a run; ⏎ is Done during a run; `c` goes to "Add to queue…".
  const keysRef = useRef({ queueRun, canEdit, running, mode: prefs.runMode });
  useEffect(() => {
    keysRef.current = { queueRun, canEdit, running, mode: prefs.runMode };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const k = keysRef.current;
      const target = e.target instanceof Element ? e.target : null;
      if (
        target?.closest(
          '[role="dialog"], [role="menu"], [role="listbox"], [data-slot="popover-content"]',
        )
      ) {
        return;
      }
      const typing =
        !!target && target.closest("input, textarea, select, [contenteditable='true']") !== null;
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        if (k.running || !k.canEdit || !k.queueRun.head) return;
        e.preventDefault();
        k.queueRun.start(k.mode);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const interactive = !!target && target.closest("button, a, [role='button']") !== null;
      if (e.key === "Enter" && !e.shiftKey && !interactive && k.running && k.canEdit) {
        if (!k.queueRun.nowTask) return;
        e.preventDefault();
        k.queueRun.done();
        return;
      }
      if (e.key === "c" && !e.shiftKey && !interactive && k.canEdit) {
        e.preventDefault();
        addRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const addRow = canEdit ? (
    <AddToQueueRow inputRef={addRef} onAdd={(title) => api.captureToQueue(title)} />
  ) : null;

  if (running) {
    return (
      <RunBody
        api={api}
        queueRun={queueRun}
        workspaceId={workspaceId}
        runtime={runtime}
        bucketNameById={bucketNameById}
        parentTitleFor={parentTitleFor}
        blockedNoteFor={blockedNoteFor}
        canEdit={canEdit}
        selectedTaskId={selectedTaskId}
        onSelectTask={onSelectTask}
        prefs={prefs}
        onPrefsChange={setPrefs}
        addRow={addRow}
        dndMode={dndMode}
      />
    );
  }

  return (
    <LineUp
      api={api}
      queueRun={queueRun}
      workspaceId={workspaceId}
      otherRunWorkspaceName={otherRunWorkspaceName}
      canEdit={canEdit}
      mode={prefs.runMode}
      onModeChange={(runMode) => setPrefs({ runMode })}
      selectedTaskId={selectedTaskId}
      onSelectTask={onSelectTask}
      onRequestCapture={onRequestCapture}
      addRow={addRow}
      dndMode={dndMode}
    />
  );
}

// ── the line-up (no run) ──────────────────────────────────────────────────────

function LineUp({
  api,
  queueRun,
  workspaceId,
  otherRunWorkspaceName,
  canEdit,
  mode,
  onModeChange,
  selectedTaskId,
  onSelectTask,
  onRequestCapture,
  addRow,
  dndMode,
}: {
  api: TasksModuleApi;
  queueRun: QueueRunApi;
  workspaceId: string;
  otherRunWorkspaceName: string | null;
  canEdit: boolean;
  mode: FocusRunMode;
  onModeChange: (mode: FocusRunMode) => void;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  onRequestCapture: () => void;
  addRow: React.ReactNode;
  dndMode: "internal" | "external";
}) {
  const capacity = lineUpCapacity(api.queuedTasks);
  const [reviewing, setReviewing] = useState(false);
  const [, setKept] = useState(0);
  const touchedAt = Math.max(
    lineUpTouchedAt(api.myQueueEntries) ?? 0,
    lineUpKeptAt.get(workspaceId) ?? 0,
  );
  const staleDays =
    canEdit && capacity.count > 0 ? staleLineUpDays(touchedAt || null, Date.now()) : null;

  const keep = () => {
    lineUpKeptAt.set(workspaceId, Date.now());
    setKept((n) => n + 1);
    setReviewing(false);
    api.keepLineUp();
  };

  const ended =
    queueRun.ended && queueRun.ended.workspaceId === workspaceId ? queueRun.ended : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 shrink-0 space-y-1.5">
        <Toolbar>
          <h1 className="truncate font-display text-lg text-foreground">Queue</h1>
          {capacity.count > 0 ? (
            <span className="truncate font-sans text-sm tabular-nums text-muted-foreground">
              {capacityLabel(capacity)}
            </span>
          ) : null}
          <Toolbar.Spacer />
          {canEdit ? (
            <Toolbar.Group>
              <SegmentedControl
                aria-label="Run rhythm"
                size="sm"
                value={mode}
                onValueChange={(v) => onModeChange(v === "stopwatch" ? "stopwatch" : "pomodoro")}
                items={[
                  { value: "pomodoro", label: "Pomodoro" },
                  { value: "stopwatch", label: "Stopwatch" },
                ]}
              />
            </Toolbar.Group>
          ) : null}
          <Toolbar.Primary>
            {canEdit ? (
              <Button
                size="sm"
                onClick={() => queueRun.start(mode)}
                disabled={!queueRun.head}
                aria-keyshortcuts="Meta+Enter"
              >
                <Play aria-hidden />
                Start run
              </Button>
            ) : null}
          </Toolbar.Primary>
        </Toolbar>
        {otherRunWorkspaceName ? (
          <p className="font-sans text-xs text-muted-foreground">
            Your run is on in {otherRunWorkspaceName}. Starting one here ends it.
          </p>
        ) : null}
        {ended ? <EndedRunLine run={ended} onDismiss={queueRun.dismissEnded} /> : null}
        {staleDays !== null && !reviewing ? (
          <div className="flex flex-wrap items-center gap-1.5 rounded-md bg-state-hover px-3 py-2 font-sans text-sm text-muted-foreground">
            <span>Lined up {staleDays} days ago — still want all of these?</span>
            <button
              type="button"
              className="font-medium text-foreground hover:underline"
              onClick={keep}
            >
              Keep all
            </button>
            <span aria-hidden>·</span>
            <button
              type="button"
              className="font-medium text-foreground hover:underline"
              onClick={() => setReviewing(true)}
            >
              Review
            </button>
          </div>
        ) : null}
        {reviewing ? (
          <div className="flex items-center gap-2 rounded-md bg-state-hover px-3 py-2 font-sans text-sm text-muted-foreground">
            <span className="min-w-0 flex-1">Remove what you don't want any more.</span>
            <Button size="sm" variant="secondary" onClick={keep}>
              Done
            </Button>
          </div>
        ) : null}
      </div>

      <div className="pane-scroll min-h-0 flex-1 overflow-auto">
        {api.queuedTasks.length === 0 ? (
          <EmptyState
            title="Nothing lined up."
            hint={
              canEdit ? (
                <>
                  Press <Kbd>q</Kbd> on any task, drag tasks onto Queue, or capture straight in.
                </>
              ) : undefined
            }
            action={
              canEdit ? (
                <Button variant="secondary" size="sm" onClick={onRequestCapture}>
                  <Plus aria-hidden />
                  Add a task
                </Button>
              ) : undefined
            }
          />
        ) : (
          <QueueList
            api={api}
            tasks={api.queuedTasks}
            canEdit={canEdit}
            selectedTaskId={selectedTaskId}
            onSelectTask={onSelectTask}
            reviewing={reviewing}
            onRemove={queueRun.remove}
            onDoNow={null}
            dndMode={dndMode}
          />
        )}
        {addRow}
      </div>
    </div>
  );
}

function EndedRunLine({
  run,
  onDismiss,
}: {
  run: NonNullable<QueueRunApi["ended"]>;
  onDismiss: () => void;
}) {
  const done = run.doneTaskIds.length;
  return (
    <div className="flex items-center gap-2 font-sans text-xs text-muted-foreground">
      <Check className="size-icon-xs shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        Run ended · {done} done · {formatDuration(run.focusedSeconds)} focused
      </span>
      <IconButton icon={X} label="Dismiss" size="sm" onClick={onDismiss} />
    </div>
  );
}

// ── the run ──────────────────────────────────────────────────────────────────

function RunBody({
  api,
  queueRun,
  workspaceId,
  runtime,
  bucketNameById,
  parentTitleFor,
  blockedNoteFor,
  canEdit,
  selectedTaskId,
  onSelectTask,
  prefs,
  onPrefsChange,
  addRow,
  dndMode,
}: {
  api: TasksModuleApi;
  queueRun: QueueRunApi;
  workspaceId: string;
  runtime: ModuoRuntime | null;
  bucketNameById: (id: string) => string;
  parentTitleFor: (task: Task) => string | null;
  blockedNoteFor: (task: Task) => string | null;
  canEdit: boolean;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  prefs: FocusPrefs;
  onPrefsChange: (patch: Partial<FocusPrefs>) => void;
  addRow: React.ReactNode;
  dndMode: "internal" | "external";
}) {
  const run = queueRun.run;
  const reading = useRunReading(run);
  const session = useFocusSession();
  const [showDone, setShowDone] = useState(false);
  if (!run || !reading) return null;
  const now = queueRun.nowTask;
  const upNextMinutes = queueRun.upNext.reduce((m, t) => m + (t.durationMinutes ?? 0), 0);
  const phaseText = !reading.pomodoro
    ? "Focus"
    : reading.phase === "work"
      ? "Focus"
      : reading.phase === "long_break"
        ? "Long break"
        : "Break";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 shrink-0">
        <Toolbar>
          <h1 className="truncate font-display text-lg text-foreground">Queue</h1>
          <span className="flex min-w-0 items-center gap-2 font-sans text-sm text-muted-foreground">
            {reading.running ? (
              <LiveDot />
            ) : (
              <Pause className="size-icon-xs shrink-0" aria-hidden />
            )}
            <span className="truncate tabular-nums">
              {reading.running ? "Running" : "Paused"} · {queueRun.progress.done} of{" "}
              {queueRun.progress.total} done
            </span>
          </span>
          <Toolbar.Spacer />
          <Toolbar.Group>
            <PhasePill
              text={phaseText}
              clock={formatClock(reading.bigClock)}
              task={now}
              canEdit={canEdit}
              onAddTime={(id, s) => void api.logTimeAdjustment(id, s)}
              onSetTime={api.setTimeSpent}
              prefs={prefs}
              onPrefsChange={onPrefsChange}
              phaseKey={`${session.phase}:${session.longBreak}`}
            />
            {canEdit ? (
              <IconButton
                icon={reading.running ? Pause : Play}
                label={reading.running ? "Pause run" : "Resume run"}
                size="sm"
                onClick={queueRun.togglePause}
              />
            ) : null}
          </Toolbar.Group>
          <Toolbar.Primary>
            <Button size="sm" variant="secondary" onClick={queueRun.end}>
              End run
            </Button>
          </Toolbar.Primary>
        </Toolbar>
      </div>

      <div className="pane-scroll min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
          {!queueRun.inControl ? (
            <p className="font-sans text-xs text-muted-foreground">
              Running on your other device. Acting here takes it over.
            </p>
          ) : null}
          {queueRun.notice ? (
            <div className="flex items-center gap-2 rounded-md bg-state-hover px-3 py-2 font-sans text-sm text-muted-foreground">
              <span className="min-w-0 flex-1">{queueRun.notice}</span>
              <IconButton icon={X} label="Dismiss" size="sm" onClick={queueRun.dismissNotice} />
            </div>
          ) : null}
          {queueRun.inControl && session.away ? <FocusAwayPrompt away={session.away} /> : null}

          {now ? (
            <NowCard
              task={now}
              api={api}
              workspaceId={workspaceId}
              runtime={runtime}
              bucketName={bucketNameById(now.bucketId)}
              parentTitle={parentTitleFor(now)}
              blockedNote={blockedNoteFor(now)}
              canEdit={canEdit}
              accrued={queueRun.inControl && session.taskId === now.id ? session.accrued : 0}
              canSkip={queueRun.upNext.length > 0}
              onDone={queueRun.done}
              onSkip={queueRun.skip}
              onRemove={() => queueRun.remove(now.id)}
              onOpen={() => onSelectTask(now.id)}
            />
          ) : (
            <p className="font-sans text-sm text-muted-foreground">Loading the queue…</p>
          )}

          <div className="flex flex-col">
            <div className="flex h-7 items-center gap-1.5 px-2">
              <Eyebrow as="span" tone="muted">
                Up next
              </Eyebrow>
              <span className="font-sans text-xs tabular-nums text-muted-foreground">
                {queueRun.upNext.length}
              </span>
              {upNextMinutes > 0 ? (
                <span className="ml-auto font-sans text-xs tabular-nums text-muted-foreground">
                  ~{formatMinutes(upNextMinutes)}
                </span>
              ) : null}
            </div>
            {queueRun.upNext.length === 0 ? (
              <p className="px-2 py-1 font-sans text-sm text-muted-foreground">
                Last one — nothing else lined up.
              </p>
            ) : (
              <QueueList
                api={api}
                tasks={queueRun.upNext}
                canEdit={canEdit}
                selectedTaskId={selectedTaskId}
                onSelectTask={onSelectTask}
                reviewing={false}
                onRemove={queueRun.remove}
                onDoNow={queueRun.doNow}
                dimFrom={2}
                fixedFirst={now?.id ?? null}
                dndMode={dndMode}
              />
            )}
            {addRow}
            {queueRun.doneTasks.length > 0 ? (
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => setShowDone((v) => !v)}
                  aria-expanded={showDone}
                  className="flex h-7 items-center gap-2 px-2 text-left font-sans text-xs text-muted-foreground hover:text-foreground"
                >
                  <Check className="size-icon-xs" aria-hidden />
                  {queueRun.doneTasks.length} done this run ·{" "}
                  {formatDuration(reading.focusedSeconds)} · {showDone ? "hide" : "show"}
                </button>
                {showDone
                  ? queueRun.doneTasks.map((t) => (
                      <div
                        key={t.id}
                        className="flex h-(--row-h) items-center gap-2 px-2 font-sans text-sm text-muted-foreground line-through"
                      >
                        <span className="min-w-0 flex-1 truncate">{t.title || "Untitled"}</span>
                      </div>
                    ))
                  : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** "◐ Focus 18:42 ▾": the phase and its clock; the menu holds the time tools. */
function PhasePill({
  text,
  clock,
  task,
  canEdit,
  onAddTime,
  onSetTime,
  prefs,
  onPrefsChange,
  phaseKey,
}: {
  text: string;
  clock: string;
  task: Task | null;
  canEdit: boolean;
  onAddTime: (taskId: string, seconds: number) => void;
  onSetTime: (taskId: string, seconds: number) => void;
  prefs: FocusPrefs;
  onPrefsChange: (patch: Partial<FocusPrefs>) => void;
  phaseKey: string;
}) {
  const [setMin, setSetMin] = useState("");
  // Edited intervals show right away while paused.
  useEffect(() => {
    previewFocusInterval(prefs);
  }, [prefs, phaseKey]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${text} ${clock} · time options`}
          className="flex h-(--ctrl-h-sm) items-center gap-2 rounded-md bg-state-active px-2.5 font-sans text-sm font-medium text-foreground transition-colors hover:bg-state-active-hover"
        >
          <Timer className="size-icon-xs shrink-0" aria-hidden />
          <span>{text}</span>
          <span className="tabular-nums">{clock}</span>
          <ChevronDown className="size-icon-xs shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 text-left">
        <div className="flex flex-col gap-3">
          {task && canEdit ? (
            <>
              <div>
                <Eyebrow as="p">Add time</Eyebrow>
                <div className="mt-1.5 flex gap-1.5">
                  {[5, 15, 30].map((m) => (
                    <Button
                      key={m}
                      variant="secondary"
                      size="sm"
                      onClick={() => onAddTime(task.id, m * 60)}
                    >
                      +{m}m
                    </Button>
                  ))}
                </div>
              </div>
              <div>
                <Eyebrow as="p">Set total (min)</Eyebrow>
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
                      if (Number.isFinite(n) && setMin !== "")
                        onSetTime(task.id, Math.max(0, n) * 60);
                      setSetMin("");
                    }}
                  >
                    Set
                  </Button>
                </div>
              </div>
            </>
          ) : null}
          <div className={cn(task && canEdit && "border-t border-border pt-3")}>
            <Eyebrow as="p">Pomodoro</Eyebrow>
            <div className="mt-1.5 flex items-center gap-2 font-sans text-sm text-muted-foreground">
              <span>Work</span>
              <Input
                size="sm"
                type="number"
                min={1}
                max={180}
                value={String(prefs.workMinutes)}
                onChange={(e) =>
                  onPrefsChange({ workMinutes: Math.max(1, Number(e.target.value) || 1) })
                }
                className="w-14"
              />
              <span>Break</span>
              <Input
                size="sm"
                type="number"
                min={1}
                max={180}
                value={String(prefs.breakMinutes)}
                onChange={(e) =>
                  onPrefsChange({ breakMinutes: Math.max(1, Number(e.target.value) || 1) })
                }
                className="w-14"
              />
            </div>
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

// ── Now ──────────────────────────────────────────────────────────────────────

function NowCard({
  task,
  api,
  workspaceId,
  runtime,
  bucketName,
  parentTitle,
  blockedNote,
  canEdit,
  accrued,
  canSkip,
  onDone,
  onSkip,
  onRemove,
  onOpen,
}: {
  task: Task;
  api: TasksModuleApi;
  workspaceId: string;
  runtime: ModuoRuntime | null;
  bucketName: string;
  parentTitle: string | null;
  blockedNote: string | null;
  canEdit: boolean;
  /** Focus time on this task not in its saved total yet. */
  accrued: number;
  canSkip: boolean;
  onDone: () => void;
  onSkip: () => void;
  onRemove: () => void;
  onOpen: () => void;
}) {
  const tags = api.tagsByTask.get(task.id) ?? [];
  const subtasks = api.subtasksByParent.get(task.id) ?? [];
  const due = formatDue(task.dueDate);
  const scheduled = formatScheduled(task.scheduledAt);
  const tracked = task.timeSpentSeconds + accrued;
  const subLine =
    blockedNote ??
    [parentTitle ? `Part of ${parentTitle}` : null, scheduled ? `Scheduled ${scheduled}` : null]
      .filter(Boolean)
      .join("  ·  ");
  const claim = useQueueClaim(task.id, api, workspaceId);

  return (
    // elevated: --popover sits one step lighter than the --card panel.
    <div className="rounded-lg border border-border bg-popover px-6 py-5" data-task-id={task.id}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-xs text-muted-foreground">
        <span className="truncate">{bucketName}</span>
        {task.priority ? (
          <span className="inline-flex items-center gap-1">
            <PriorityIcon level={task.priority} />
            {PRIORITY_LABELS[task.priority]}
          </span>
        ) : null}
        {due ? (
          <span className="inline-flex items-center gap-1">
            <Calendar className="size-icon-xs" aria-hidden />
            Due {due}
          </span>
        ) : null}
        {tracked > 0 || task.durationMinutes ? (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Timer className="size-icon-xs" aria-hidden />
            {formatDuration(tracked)}
            {task.durationMinutes ? ` of ~${formatMinutes(task.durationMinutes)}` : ""}
          </span>
        ) : null}
        <MetaCounts>
          <MetaCount
            icon={Hash}
            count={tags.length}
            label={(n) => (n === 1 ? "1 tag" : `${n} tags`)}
          />
        </MetaCounts>
        {claim.onThis.length > 0 || claim.names.length > 0 ? (
          <span className="ml-auto inline-flex items-center gap-1.5">
            <ClaimAvatar
              assignee={claim.onThisFirst ?? claim.first}
              live={claim.onThis.length > 0}
            />
          </span>
        ) : null}
      </div>
      <h2 className="mt-1.5 font-display text-2xl text-foreground">{task.title || "Untitled"}</h2>
      {subLine ? <p className="mt-1 font-sans text-xs text-muted-foreground">{subLine}</p> : null}
      {task.description ? (
        <EntityRichText
          html={task.description}
          className="mt-3 line-clamp-4 font-sans text-sm leading-relaxed text-muted-foreground"
        />
      ) : null}

      {subtasks.length > 0 ? (
        <div className="mt-4">
          <Eyebrow as="p" tone="muted">
            Subtasks {subtasks.filter((s) => s.status === "done").length}/{subtasks.length}
          </Eyebrow>
          <div className="mt-1.5 flex flex-col">
            {subtasks.map((st) => {
              const isDone = st.status === "done";
              return (
                <div
                  key={st.id}
                  className="flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-state-hover"
                >
                  <CompleteToggle
                    done={isDone}
                    onToggle={() => api.toggleDone(st)}
                    disabled={!canEdit}
                  />
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
      ) : null}

      <LinkedChips runtime={runtime} workspaceId={workspaceId} taskId={task.id} />

      <div className="mt-5 flex items-center gap-2 border-t border-border pt-4">
        {canEdit ? (
          <>
            <Button size="md" onClick={onDone} aria-keyshortcuts="Enter">
              <Check aria-hidden />
              Done
              <kbd className="flex items-center opacity-80">
                <CornerDownLeft className="size-3" aria-hidden />
              </kbd>
            </Button>
            <Button size="md" variant="secondary" onClick={onSkip} disabled={!canSkip}>
              Skip
            </Button>
          </>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              icon={MoreHorizontal}
              label="More for this task"
              className="ml-auto"
              tooltip={null}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onOpen}>Open task</DropdownMenuItem>
            {canEdit ? (
              <>
                <DropdownMenuItem onSelect={onSkip} disabled={!canSkip}>
                  Do later today
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onRemove}>Remove from queue</DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** The Now task's linked items; each opens in its module (F2-3). */
function LinkedChips({
  runtime,
  workspaceId,
  taskId,
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string;
  taskId: string;
}) {
  const focus = useMemo(() => ({ type: "task" as const, id: taskId }), [taskId]);
  const hub = useEntityHub(runtime, workspaceId, focus);
  const rows = hub.sections
    .flatMap((s) => s.rows)
    .filter((r) => !r.tombstoned)
    .slice(0, 6);
  if (rows.length === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-1.5">
      {rows.map((row) => {
        const Icon = resolveEntityIcon(row.other.type, row.icon);
        return (
          <button
            key={`${row.other.type}:${row.other.id}`}
            type="button"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent(ENTITY_OPEN_EVENT, {
                  detail: { type: row.other.type, id: row.other.id },
                }),
              )
            }
            className="inline-flex h-(--ctrl-h-sm) max-w-full items-center gap-1.5 rounded-md border border-border px-2 font-sans text-xs text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
          >
            <Icon className="size-icon-xs shrink-0" aria-hidden />
            <span className="truncate">{row.title}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── the numbered list (line-up and Up next) ──────────────────────────────────

function QueueList({
  api,
  tasks,
  canEdit,
  selectedTaskId,
  onSelectTask,
  reviewing,
  onRemove,
  onDoNow,
  dimFrom,
  fixedFirst = null,
  dndMode,
}: {
  api: TasksModuleApi;
  tasks: Task[];
  canEdit: boolean;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  /** Review mode (stale line): each row offers Remove. */
  reviewing: boolean;
  onRemove: (id: string) => void;
  /** Up next only: "Do now" in the row's menu. */
  onDoNow: ((id: string) => void) | null;
  /** Rows from this index on are dimmed (Up next: 3rd and later). */
  dimFrom?: number;
  /** A task that stays first in my queue (Now), above this list. */
  fixedFirst?: string | null;
  dndMode: "internal" | "external";
}) {
  const sensors = useTaskDndSensors();
  const open = tasks.filter((t) => t.status !== "done" && t.status !== "archived");
  const ids = useMemo(() => open.map((t) => t.id), [open]);
  const canDrag = canEdit && !reviewing && open.length > 1;

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const moved = arrayMove(ids, from, to);
    api.reorderQueue(fixedFirst ? [fixedFirst, ...moved] : moved);
  };

  let n = 0;
  const rows = tasks.map((task) => {
    const done = task.status === "done";
    const index = done ? null : n++;
    const row = (drag?: {
      listeners: DraggableSyntheticListeners;
      activator: DragActivatorRef;
    }) => (
      <QueueRow
        task={task}
        api={api}
        index={index}
        dim={dimFrom !== undefined && index !== null && index >= dimFrom}
        selected={task.id === selectedTaskId}
        canEdit={canEdit}
        reviewing={reviewing}
        onSelect={() => onSelectTask(task.id)}
        onRemove={() => onRemove(task.id)}
        onDoNow={onDoNow ? () => onDoNow(task.id) : null}
        dragListeners={drag?.listeners}
        dragActivatorRef={drag?.activator}
      />
    );
    if (!canDrag || done) return <div key={task.id}>{row()}</div>;
    return (
      <SortableTask
        key={task.id}
        id={task.id}
        from="queue"
        render={({ dragListeners, dragActivatorRef }) =>
          row({ listeners: dragListeners, activator: dragActivatorRef })
        }
      />
    );
  });

  if (!canDrag) return <div role="list">{rows}</div>;
  return (
    <DndBoundary
      dndMode={dndMode}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div role="list">{rows}</div>
      </SortableContext>
    </DndBoundary>
  );
}

function QueueRow({
  task,
  api,
  index,
  dim,
  selected,
  canEdit,
  reviewing,
  onSelect,
  onRemove,
  onDoNow,
  dragListeners,
  dragActivatorRef,
}: {
  task: Task;
  api: TasksModuleApi;
  index: number | null;
  dim: boolean;
  selected: boolean;
  canEdit: boolean;
  reviewing: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onDoNow: (() => void) | null;
  dragListeners?: DraggableSyntheticListeners;
  dragActivatorRef?: DragActivatorRef;
}) {
  const { byId } = useAssignees();
  const claim = useQueueClaim(task.id, api, task.workspaceId);
  const done = task.status === "done";
  const live = claim.onThis.length > 0;
  const face = live ? claim.onThisFirst : claim.first;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a list row with its own buttons inside
    <div
      role="listitem"
      ref={dragActivatorRef}
      {...dragListeners}
      data-task-id={task.id}
      onClick={onSelect}
      className={cn(
        "group flex min-h-(--row-h) cursor-default items-center gap-3 rounded-md px-2 transition-colors hover:bg-state-hover",
        selected && "bg-state-selected hover:bg-state-selected",
        dim && "opacity-60",
      )}
    >
      <span className="flex w-5 shrink-0 justify-end font-sans text-xs tabular-nums text-muted-foreground">
        {index === null ? (
          <Check className="size-icon-xs" aria-hidden />
        ) : (
          <>
            <span className={cn(canEdit && dragListeners && "group-hover:hidden")}>
              {index + 1}
            </span>
            {canEdit && dragListeners ? (
              <GripVertical className="hidden size-icon-xs group-hover:block" aria-hidden />
            ) : null}
          </>
        )}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-sans text-md",
          done ? "text-muted-foreground line-through" : "text-foreground",
        )}
      >
        {task.title || "Untitled"}
      </span>
      {task.durationMinutes ? (
        <span className="shrink-0 font-sans text-xs tabular-nums text-muted-foreground">
          ~{formatMinutes(task.durationMinutes)}
        </span>
      ) : null}
      {face ? (
        <span
          className="flex shrink-0 items-center"
          title={
            live ? `${claim.onThis.join(", ")} on this` : `In ${claim.names.join(", ")}'s queue`
          }
        >
          <ClaimAvatar assignee={face} live={live} />
        </span>
      ) : task.assigneeId ? (
        <AssigneeAvatar assignee={byId(task.assigneeId)} className="size-4 shrink-0" />
      ) : null}
      {canEdit && !done ? (
        reviewing ? (
          <IconButton
            icon={X}
            label="Remove from queue"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          />
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                icon={MoreHorizontal}
                label={`More for ${task.title || "this task"}`}
                size="sm"
                tooltip={null}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onDoNow ? <DropdownMenuItem onSelect={onDoNow}>Do now</DropdownMenuItem> : null}
              <DropdownMenuItem onSelect={onSelect}>Open task</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onRemove}>Remove from queue</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      ) : null}
    </div>
  );
}

// ── Add to queue… ────────────────────────────────────────────────────────────

function AddToQueueRow({
  inputRef,
  onAdd,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onAdd: (title: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="flex min-h-(--row-h) items-center gap-3 rounded-md px-2 text-muted-foreground transition-colors focus-within:bg-state-hover hover:bg-state-hover">
      <Plus className="size-icon-sm shrink-0" aria-hidden />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const title = value.trim();
            if (!title) return;
            onAdd(title);
            setValue("");
          } else if (e.key === "Escape") {
            setValue("");
            e.currentTarget.blur();
          }
        }}
        placeholder="Add to queue…"
        aria-label="Add a task to your queue"
        className="min-w-0 flex-1 bg-transparent font-sans text-md text-foreground outline-none placeholder:text-muted-foreground"
      />
      <Kbd>c</Kbd>
    </div>
  );
}
