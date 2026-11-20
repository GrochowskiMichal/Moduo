// The Now card of the Focus screen (TV-F7, spec §7; REPLAN 62, 62a, 63, 65a;
// prototype round-2a frames 1–2): one quiet line (project › section or parent
// · due, the priority mark when high), the one timer pill (Per task) or Start,
// the title, the folded description, references as chips, the subtasks as an
// unordered checklist with small marks, and Done ⏎ · Skip S · Hand off W
// (TV-F8). A subtask opens its own details in the panel; ⇧F on it makes it
// the Now card. An agent at work on the task shows as one line under the
// title (call 52, TV-D16's `AgentSessionLines`).

import { type FocusTimerMode, isClosedTask } from "@contracts/vocabularies";
import { Paperclip, Pause, Play } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Button } from "../../../components/ui/button";
import { CompleteToggle } from "../../../components/ui/complete-toggle";
import { Kbd } from "../../../components/ui/kbd";
import { MetaCount } from "../../../components/ui/meta-count";
import { NavRowDot } from "../../../components/ui/nav-row";
import { SELECTED_ROW } from "../../../components/ui/selection";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { formatDay } from "../../../lib/time-format";
import { cn } from "../../../lib/utils";
import { filesLabel } from "../../attachments/files";
import type { TaskRefResolver } from "../../focus/run";
import { toggleFocusPause, useFocusTimer } from "../../focus/timer";
import { FocusAwayPrompt } from "../../focus/ui/away-prompt";
import { TaskClaimMark } from "../../focus/ui/claim-mark";
import { EntityTextEditor } from "../../spine/editor/lazy-entity-text-editor";
import { useEntityHub } from "../../spine/hooks/use-entity-hub";
import { Reference } from "../../spine/references/ui/reference";
import { byIdOf } from "../derived";
import { pillReading } from "../focus-screen";
import { estimateOf, type Task } from "../model";
import { bucketDotColor } from "../sidebar";
import {
  useSubtasksOf,
  useTaskById,
  useTaskCommands,
  useTasksSelector,
  useTasksUserId,
} from "../tasks-context";
import { nowOn, useToday } from "../use-today";
import { type HandOff, HandOffPopover } from "./focus-hand-off";
import { PriorityMark } from "./level-icons";
import { AgentSessionLines } from "./task-agent-session";

export const TIMER_LABELS: Record<FocusTimerMode, string> = {
  per_task: "Per task",
  pomodoro: "Pomodoro",
  off: "Off",
};

// ── the pills (one number per job, 62) ──────────────────────────────────────

export const FOCUS_PILL =
  "inline-flex h-(--ctrl-h-sm) shrink-0 items-center gap-1.5 rounded-full border border-hairline px-2.5 font-sans text-xs tabular-nums text-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

/** The Per task pill on the Now card: "⏸ 18:02 of ~45m", "▶ Paused · 18:02". */
function TaskPill({
  task,
  countdown,
  resolveTask,
}: {
  task: Task;
  countdown: boolean;
  resolveTask: TaskRefResolver;
}) {
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
          className={FOCUS_PILL}
          aria-label={`${action} · ${t.running ? text : `Paused · ${reading.clock}`}${where}${unsaved}`}
          onClick={() => toggleFocusPause(resolveTask)}
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

export function NowCard({
  task,
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
  handOffOpen,
  onHandOffOpenChange,
  onHandOff,
}: {
  task: Task;
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
  /** Hand off W (TV-F8): its popover, open from the button or the key. */
  handOffOpen: boolean;
  onHandOffOpenChange: (open: boolean) => void;
  onHandOff: (handOff: HandOff) => void;
}) {
  const today = useToday();
  const { focusRefOf, toggleDone } = useTaskCommands();
  const me = useTasksUserId();
  const project = useTasksSelector((d) => byIdOf(d.buckets).get(task.bucketId) ?? null);
  const parent = useTaskById(task.parentId);
  const section = useTasksSelector((d) =>
    !parent
      ? (d.sections.find((s) => s.id === task.sectionId && s.projectId === task.bucketId) ?? null)
      : null,
  );
  const due = task.dueDate ? formatDay(task.dueDate, nowOn(today)) : null;
  const blocked = useTasksSelector((d) =>
    d.blockedIds.has(task.id)
      ? (d.blockersByTask.get(task.id) ?? []).filter((b) => !isClosedTask(b)).length
      : 0,
  );
  const subtasks = useSubtasksOf(task.id);
  const saving = task.id.startsWith("tmp-");
  // The 📎 mark (AT-3), live from the shared store.
  const files = useTasksSelector((_, snap) => snap.attachmentCounts?.get(task.id) ?? 0);
  // An agent's line, only when one is on this task (call 52; the line reads
  // the workspace's people, so it mounts only then).
  const agentSessions = useTasksSelector((_, snap) => snap.agentSessions);
  const hasAgent = !!agentSessions?.some((s) => s.taskId === task.id && !s.deletedAt);

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
          {files > 0 ? (
            <>
              <span aria-hidden className="text-subtle-foreground">
                ·
              </span>
              <MetaCount icon={Paperclip} count={files} label={filesLabel} />
            </>
          ) : null}
          {task.priority === "high" ? <PriorityMark level="high" /> : null}
        </p>
        <TaskClaimMark workspaceId={task.workspaceId} taskId={task.id} />
        {onNow ? (
          timer === "per_task" ? (
            <TaskPill task={task} countdown={countdown} resolveTask={focusRefOf} />
          ) : null
        ) : canEdit ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={FOCUS_PILL}
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
        <h2 className="font-sans text-2xl leading-snug text-foreground break-words">
          {task.title || "Untitled"}
        </h2>
        {hasAgent ? (
          <AgentSessionLines
            taskId={task.id}
            workspaceId={workspaceId}
            sessions={agentSessions}
            userId={me}
            runtime={runtime}
            className="pl-0"
          />
        ) : null}
        {task.description ? (
          <FoldedDescription
            key={task.id}
            description={task.description}
            runtime={runtime}
            workspaceId={workspaceId}
          />
        ) : null}
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
          onToggle={toggleDone}
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
          <HandOffPopover
            open={handOffOpen}
            onOpenChange={onHandOffOpenChange}
            me={me}
            onHandOff={onHandOff}
          >
            <Button size="sm" variant="ghost" disabled={saving} data-slot="focus-hand-off-button">
              Hand off
              <Kbd className="bg-transparent">W</Kbd>
            </Button>
          </HandOffPopover>
        </div>
      ) : null}
    </section>
  );
}

/**
 * About six lines, then "Show more" (call 56's fold, read-only here). The
 * description shows through its one editor, read-only (call #15): its Markdown
 * formatted, references live per reader.
 */
export function FoldedDescription({
  description,
  runtime,
  workspaceId,
}: {
  description: string;
  runtime: ModuoRuntime | null;
  workspaceId: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [folds, setFolds] = useState(false);
  // Measured again whenever the text's height changes: the editor fills
  // itself after it mounts. A new description mounts a new editor (its key),
  // so the observer moves to the new content.
  // A changed description replaces the observed element.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || expanded) return;
    const measure = () => setFolds(box.scrollHeight > box.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    const content = box.firstElementChild;
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [expanded, description]);
  return (
    <div>
      <div
        ref={boxRef}
        className={cn(
          "font-sans text-sm leading-relaxed break-words text-muted-foreground",
          !expanded && "max-h-36 overflow-hidden",
          !expanded && folds && "mask-b-from-60%",
        )}
      >
        {/* The editor reads its value when it mounts: a changed description
            gets a new one. */}
        <EntityTextEditor
          key={description}
          value={description}
          editable={false}
          format="markdown"
          runtime={runtime}
          workspaceId={workspaceId}
          source={null}
          ariaLabel="Description"
          className="min-h-0 text-sm text-muted-foreground"
        />
      </div>
      {folds || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="hit-min mt-1 rounded-sm font-sans text-xs text-muted-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the ids' key is the cue
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
