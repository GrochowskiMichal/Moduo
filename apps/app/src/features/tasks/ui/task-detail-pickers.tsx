// The detail panel's time pickers (Tasks v3 §9, calls 24, 25, 27i, 75):
// - Due time: an optional clock time beside the due date (the assignee's).
// - Scheduled: the task's work sessions ("Thu 2:00 PM · 1h", then "+2"),
//   each for you or the assignee (TV-D10-fix), with "Add session".
// - Reminder: your own reminders — at a time, or a day / an hour before due.
// - Estimate: 15m · 30m · 45m · 1h · 2h · 4h or typed; once timed, "1h 20m of
//   ~4h" on one line with the bar on its own line under it.
// - Repeat: presets, Custom, and always one plain summary line.
// Each value is the kit's PropertyValue opening one popover.

import type { TaskReminderKind, TaskStatusCategory } from "@contracts/vocabularies";
import { isOpenTask, taskCategoryOf } from "@contracts/vocabularies";
import {
  Bell,
  BellOff,
  CalendarClock,
  Clock,
  History,
  Plus,
  Repeat,
  RotateCcw,
  SkipForward,
  Timer,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Button } from "../../../components/ui/button";
import { Calendar } from "../../../components/ui/calendar";
import { Checkbox } from "../../../components/ui/checkbox";
import {
  DatePickerPanel,
  formatTimeText,
  TimeInput,
  useDateDraft,
} from "../../../components/ui/date-field";
import { IconButton } from "../../../components/ui/icon-button";
import { Input } from "../../../components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { PropertyValue } from "../../../components/ui/property-row";
import { SegmentedControl } from "../../../components/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { formatDayTime, formatDuration } from "../../../lib/time-format";
import { cn } from "../../../lib/utils";
import type { Assignee } from "../assignee-options";
import { useAssignees } from "../assignees";
import {
  estimateOf,
  type Task,
  type TaskCycle,
  type TaskReminder,
  type TaskSession,
} from "../model";
import {
  RECURRENCE_PRESETS,
  type RecurrencePreset,
  recurrenceFromPreset,
} from "../parse/recurrence";
import {
  defaultSpec,
  type RepeatFrequency,
  type RepeatSpec,
  repeatSummary,
  ruleFromSpec,
  WEEKDAYS,
  type WeekdayCode,
} from "../repeat";
import { cycleLine, historySummary } from "../repeat-history";
import { useTaskCommands, useTasksSelector } from "../tasks-context";
import { formatMinutes, formatTracked, parseMinutes, timeRow } from "../time-format";
import { AssigneeAvatar } from "./assignee-avatar";
import { TaskTimeEntries } from "./task-time-entries";

// ── Due time ──────────────────────────────────────────────────────────────────

/** The due date's optional clock time: "3:00 PM", or a quiet "Add time". */
export function DueTimeValue({ task, canEdit }: { task: Task; canEdit: boolean }) {
  const { patchTask } = useTaskCommands();
  const [open, setOpen] = useState(false);
  const time = task.dueTime ? task.dueTime.slice(0, 5) : "";
  if (!task.dueDate || (!canEdit && !time)) return null;
  const save = (hhmm: string | null) => {
    if ((hhmm ?? "") !== time) patchTask(task.id, { dueTime: hhmm });
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={!canEdit}>
        <PropertyValue
          empty={!time}
          className="ml-0"
          aria-label={time ? `Due time: ${formatTimeText(time)}` : "Add a due time"}
        >
          {time ? formatTimeText(time) : "Add time"}
        </PropertyValue>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-56 items-center gap-2 p-2">
        <Clock className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
        <TimeInput
          autoFocus
          value={time}
          onValueChange={(hhmm) => save(hhmm)}
          aria-label="Due time"
        />
        {time ? (
          <IconButton icon={X} label="Clear the due time" onClick={() => save(null)} />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

// ── Scheduled: work sessions ──────────────────────────────────────────────────

const SESSION_LENGTHS = [15, 30, 45, 60, 90, 120, 180, 240];

const sessionMinutes = (s: Pick<TaskSession, "startsAt" | "endsAt">) =>
  Math.max(1, Math.round((Date.parse(s.endsAt) - Date.parse(s.startsAt)) / 60000));

/** "Thu 2:00 PM · 1h": a session in the one grammar. */
export function sessionLabel(
  s: Pick<TaskSession, "startsAt" | "endsAt">,
  now = new Date(),
): string {
  return `${formatDayTime(s.startsAt, now)} · ${formatDuration(sessionMinutes(s))}`;
}

/** The session the row shows: the next one not ended, else the latest. */
export function shownSession(
  sessions: readonly TaskSession[],
  now = Date.now(),
): TaskSession | null {
  const sorted = [...sessions].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return sorted.find((s) => Date.parse(s.endsAt) > now) ?? sorted[sorted.length - 1] ?? null;
}

/**
 * A day and a time picked in place (presets, the calendar, a time field): the
 * date picker's body without a popover of its own, so it lives inside another
 * picker (a popover inside a popover loses its clicks). The action button
 * reads `shown`: what's picked so far, Enter or not.
 */
function useMoment(initial: Date | null) {
  const [value, setValue] = useState<Date | null>(initial);
  const draft = useDateDraft({
    value,
    onChange: setValue,
    withTime: true,
    open: true,
    done: () => {},
  });
  return { draft, shown: draft.shown };
}

type SessionsView = { kind: "list" } | { kind: "add" } | { kind: "move"; sessionId: string };

export function SessionsValue({
  task,
  sessions,
  canEdit,
  me,
  assignee,
  defaultOpen = false,
}: {
  task: Task;
  sessions: TaskSession[];
  canEdit: boolean;
  me: Assignee | null;
  assignee: Assignee | null;
  defaultOpen?: boolean;
}) {
  const { addSession, updateSession, removeSession } = useTaskCommands();
  const [open, setOpen] = useState(defaultOpen && canEdit);
  const [view, setView] = useState<SessionsView>(() =>
    defaultOpen && sessions.length === 0 ? { kind: "add" } : { kind: "list" },
  );
  const shown = shownSession(sessions);
  const more = sessions.length - 1;
  const sorted = [...sessions].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const moving = view.kind === "move" ? sorted.find((s) => s.id === view.sessionId) : undefined;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // With no session yet, the picker opens on adding one.
        setView(next && sessions.length === 0 && canEdit ? { kind: "add" } : { kind: "list" });
      }}
    >
      <PopoverTrigger asChild disabled={!canEdit && sessions.length === 0}>
        <PropertyValue
          empty={!shown}
          icon={<CalendarClock />}
          aria-label={shown ? `Scheduled: ${sessionLabel(shown)}` : "Scheduled: add a session"}
          trailing={
            more > 0 ? (
              <span className="shrink-0 font-sans text-xs text-muted-foreground tabular-nums">
                +{more}
              </span>
            ) : null
          }
        >
          {shown ? sessionLabel(shown) : "Add session"}
        </PropertyValue>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        {view.kind === "add" && canEdit ? (
          <AddSession
            task={task}
            me={me}
            assignee={assignee}
            onCancel={sorted.length > 0 ? () => setView({ kind: "list" }) : undefined}
            onAdd={(input) => {
              addSession(task.id, input);
              setView({ kind: "list" });
            }}
          />
        ) : moving && canEdit ? (
          <MoveSession
            session={moving}
            onCancel={() => setView({ kind: "list" })}
            onMove={(patch) => {
              updateSession(moving.id, patch);
              setView({ kind: "list" });
            }}
          />
        ) : (
          <>
            {sorted.length > 0 ? (
              <ul className="flex flex-col p-1" aria-label="Sessions">
                {sorted.map((s) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    canEdit={canEdit}
                    me={me}
                    onMove={() => setView({ kind: "move", sessionId: s.id })}
                    onResize={(endsAt) => updateSession(s.id, { endsAt })}
                    onRemove={() => removeSession(s.id)}
                  />
                ))}
              </ul>
            ) : null}
            {canEdit ? (
              <div className={cn("p-1", sorted.length > 0 && "border-t border-hairline")}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => setView({ kind: "add" })}
                >
                  <Plus aria-hidden />
                  Add session
                </Button>
              </div>
            ) : null}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function SessionRow({
  session,
  canEdit,
  me,
  onMove,
  onResize,
  onRemove,
}: {
  session: TaskSession;
  canEdit: boolean;
  me: Assignee | null;
  onMove: () => void;
  onResize: (endsAt: string) => void;
  onRemove: () => void;
}) {
  const minutes = sessionMinutes(session);
  const someoneElse = session.userId && session.userId !== me?.userId;
  return (
    <li className="group flex min-h-(--ctrl-h-sm) items-center gap-1.5 rounded-md px-1.5 font-sans text-sm hover:bg-state-hover">
      <button
        type="button"
        disabled={!canEdit}
        onClick={onMove}
        aria-label={`Move the session at ${formatDayTime(session.startsAt)}`}
        className="hit-min min-w-0 rounded-sm text-left break-words focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {formatDayTime(session.startsAt)}
      </button>
      <Select
        value={String(minutes)}
        disabled={!canEdit}
        // Resizing keeps the start and the person (TV-D10-fix).
        onValueChange={(v) =>
          onResize(new Date(Date.parse(session.startsAt) + Number(v) * 60000).toISOString())
        }
      >
        <SelectTrigger size="sm" aria-label="Session length" className="w-auto">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[...new Set([...SESSION_LENGTHS, minutes])]
            .sort((a, b) => a - b)
            .map((m) => (
              <SelectItem key={m} value={String(m)}>
                {formatDuration(m)}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      {someoneElse ? <span className="text-xs text-muted-foreground">assignee’s</span> : null}
      <span className="flex-1" />
      {canEdit ? (
        <IconButton
          icon={X}
          label="Remove session"
          onClick={onRemove}
          className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
        />
      ) : null}
    </li>
  );
}

/** Move a session: a new start, the same length and the same person. */
function MoveSession({
  session,
  onMove,
  onCancel,
}: {
  session: TaskSession;
  onMove: (patch: { startsAt: string; endsAt: string }) => void;
  onCancel: () => void;
}) {
  const minutes = sessionMinutes(session);
  const { draft, shown: start } = useMoment(new Date(session.startsAt));
  return (
    <div className="flex flex-col">
      <DatePickerPanel draft={draft} />
      <div className="flex justify-end gap-1 border-t border-hairline p-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Back
        </Button>
        <Button
          size="sm"
          disabled={!start}
          onClick={() => {
            if (!start) return;
            onMove({
              startsAt: start.toISOString(),
              endsAt: new Date(start.getTime() + minutes * 60000).toISOString(),
            });
          }}
        >
          Move
        </Button>
      </div>
    </div>
  );
}

/** A new session: when, how long, and whose (you or the assignee; nobody else). */
function AddSession({
  task,
  me,
  assignee,
  onAdd,
  onCancel,
}: {
  task: Task;
  me: Assignee | null;
  assignee: Assignee | null;
  onAdd: (input: { startsAt: string; endsAt: string; userId: string | null }) => void;
  onCancel?: () => void;
}) {
  const { draft, shown: start } = useMoment(null);
  const [minutes, setMinutes] = useState(() => estimateOf(task) ?? 60);
  const otherAssignee = assignee && me && assignee.userId !== me.userId ? assignee : null;
  const [whose, setWhose] = useState<"me" | "assignee">("me");
  const add = () => {
    if (!start) return;
    onAdd({
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + minutes * 60000).toISOString(),
      userId: whose === "assignee" && otherAssignee ? otherAssignee.userId : (me?.userId ?? null),
    });
  };
  return (
    <div className="flex flex-col">
      <DatePickerPanel draft={draft} />
      <div className="flex flex-col gap-2 border-t border-hairline p-2">
        <div className="flex items-center gap-2 font-sans text-sm">
          <span className="text-muted-foreground">For</span>
          <Select value={String(minutes)} onValueChange={(v) => setMinutes(Number(v))}>
            <SelectTrigger size="sm" aria-label="New session length" className="w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[...new Set([...SESSION_LENGTHS, minutes])]
                .sort((a, b) => a - b)
                .map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {formatDuration(m)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        {otherAssignee ? (
          <SegmentedControl
            size="sm"
            aria-label="Whose calendar"
            value={whose}
            onValueChange={(v) => setWhose(v === "assignee" ? "assignee" : "me")}
            items={[
              // "Yours", never "Mine" (MOD-137).
              { value: "me", label: "Yours" },
              { value: "assignee", label: `${otherAssignee.fullName || otherAssignee.name}’s` },
            ]}
          />
        ) : null}
        <div className="flex justify-end gap-1">
          {onCancel ? (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Back
            </Button>
          ) : null}
          <Button size="sm" disabled={!start} onClick={add}>
            <Plus aria-hidden />
            Add session
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Reminder (your own) ───────────────────────────────────────────────────────

/** Paused by Backlog or Won't do (TV-D12) and not sent yet. */
export function isPausedReminder(r: Pick<TaskReminder, "suspendedAt" | "firedAt">): boolean {
  return !!r.suspendedAt && !r.firedAt;
}

/** A paused reminder at a set time that has already gone by: restoring can't bring it back. */
export function pausedAndPassed(r: Pick<TaskReminder, "kind" | "at">, now = Date.now()): boolean {
  return r.kind === "at" && !!r.at && Date.parse(r.at) <= now;
}

/** Why the paused reminders wait, and how they come back. */
export function pausedNote(
  category: TaskStatusCategory,
  canRestore: boolean,
  count: number,
): string {
  const them = count === 1 ? "it" : "them";
  if (canRestore)
    return "Paused while it sat in Backlog or Won’t do. Only times still ahead come back.";
  if (category === "todo" || category === "in_progress") {
    return count === 1
      ? "Its time went by while it was paused. Remove it, or add a new one."
      : "Their times went by while they were paused. Remove them, or add new ones.";
  }
  if (category === "backlog")
    return `Paused while it’s in Backlog. Move it to To do to restore ${them}.`;
  if (category === "wont_do")
    return `Paused while it’s in Won’t do. Move it to To do to restore ${them}.`;
  return `Paused. Reopen it to restore ${them}.`;
}

/** "1 day before due" · "Oct 14, 3:00 PM". */
export function reminderLabel(r: Pick<TaskReminder, "kind" | "at">, now = new Date()): string {
  if (r.kind === "day_before") return "1 day before due";
  if (r.kind === "hour_before") return "1 hour before due";
  return r.at ? formatDayTime(r.at, now) : "Reminder";
}

export function ReminderValue({
  task,
  reminders,
  defaultOpen = false,
}: {
  task: Task;
  reminders: TaskReminder[];
  defaultOpen?: boolean;
}) {
  const { addReminder, removeReminder, restoreReminders } = useTaskCommands();
  const [open, setOpen] = useState(defaultOpen);
  const [picking, setPicking] = useState(false);
  const first = reminders[0] ?? null;
  const has = (kind: TaskReminderKind) => reminders.some((r) => r.kind === kind);
  const add = (kind: TaskReminderKind, when: string | null = null) => {
    addReminder(task.id, kind, when);
  };
  // Backlog and Won't do pause reminders (TV-D12); they come back by asking,
  // once the task is To do or In progress again.
  const paused = reminders.filter(isPausedReminder);
  const category = taskCategoryOf(task);
  // A paused one at a set time that has gone by can't come back: no Restore for it.
  const canRestore =
    paused.some((r) => !pausedAndPassed(r)) && (category === "todo" || category === "in_progress");
  const firstLabel = first
    ? `${reminderLabel(first)}${isPausedReminder(first) ? " · paused" : ""}`
    : null;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setPicking(false);
      }}
    >
      <PopoverTrigger asChild>
        <PropertyValue
          empty={!first}
          icon={first && isPausedReminder(first) ? <BellOff /> : <Bell />}
          aria-label={firstLabel ? `Reminder: ${firstLabel}` : "Reminder: add one"}
          className={first && isPausedReminder(first) ? "text-muted-foreground" : undefined}
          trailing={
            reminders.length > 1 ? (
              <span className="shrink-0 font-sans text-xs text-muted-foreground tabular-nums">
                +{reminders.length - 1}
              </span>
            ) : null
          }
        >
          {/* Never "Remind me" (MOD-137); the empty value reads like "Add time". */}
          {firstLabel ?? "Add reminder"}
        </PropertyValue>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn("p-1", picking ? "w-72 p-0" : "w-64")}>
        {picking ? (
          <RemindAt
            onCancel={() => setPicking(false)}
            onPick={(when) => {
              add("at", when.toISOString());
              setPicking(false);
            }}
          />
        ) : (
          <>
            {reminders.length > 0 ? (
              <ul aria-label="Your reminders" className="border-b border-hairline pb-1">
                {reminders.map((r) => {
                  const isPaused = isPausedReminder(r);
                  const Icon = isPaused ? BellOff : Bell;
                  return (
                    <li
                      key={r.id}
                      className="group flex min-h-(--ctrl-h-sm) items-center gap-2 rounded-md px-2 font-sans text-sm hover:bg-state-hover"
                    >
                      <Icon className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
                      <span
                        className={cn(
                          "min-w-0 flex-1 break-words",
                          isPaused && "text-muted-foreground",
                        )}
                      >
                        {reminderLabel(r)}
                        {isPaused ? " · Paused" : ""}
                      </span>
                      <IconButton
                        icon={X}
                        label="Remove reminder"
                        onClick={() => removeReminder(r.id)}
                        className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                      />
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {paused.length > 0 ? (
              <div className="flex flex-col gap-0.5 border-b border-hairline py-1">
                {canRestore ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-start"
                    onClick={() => {
                      restoreReminders(task.id);
                      setOpen(false);
                    }}
                  >
                    <RotateCcw aria-hidden />
                    {paused.length === 1
                      ? "Restore the reminder"
                      : `Restore ${paused.length} reminders`}
                  </Button>
                ) : null}
                <p className="px-2 py-1 font-sans text-xs text-muted-foreground">
                  {pausedNote(category, canRestore, paused.length)}
                </p>
              </div>
            ) : null}
            <div className="flex flex-col gap-0.5 pt-1">
              {(["hour_before", "day_before"] as const).map((kind) => (
                <Button
                  key={kind}
                  variant="ghost"
                  size="sm"
                  className="justify-start"
                  disabled={!task.dueDate || has(kind)}
                  onClick={() => add(kind)}
                >
                  {reminderLabel({ kind, at: null })}
                </Button>
              ))}
              {!task.dueDate ? (
                <p className="px-2 py-1 font-sans text-xs text-muted-foreground">
                  Set a due date to remind before it.
                </p>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="justify-start"
                onClick={() => setPicking(true)}
              >
                At a time…
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** "At a time…": a moment picked in place. */
function RemindAt({ onPick, onCancel }: { onPick: (when: Date) => void; onCancel: () => void }) {
  const { draft, shown } = useMoment(null);
  return (
    <div className="flex flex-col">
      <DatePickerPanel draft={draft} />
      <div className="flex justify-end gap-1 border-t border-hairline p-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Back
        </Button>
        <Button size="sm" disabled={!shown} onClick={() => shown && onPick(shown)}>
          Set reminder
        </Button>
      </div>
    </div>
  );
}

// ── Estimate (and tracked time) ───────────────────────────────────────────────

const ESTIMATE_PRESETS = [15, 30, 45, 60, 120, 240];

/**
 * "1h 20m of ~4h": the tracked and estimated time stay one unit that never
 * breaks (checkpoint 1: "0m of / ~1h"); the bar sits on its own line under it,
 * and "you 50m" after it when it's a part.
 */
export function EstimateValue({
  task,
  canEdit,
  mySeconds,
  defaultOpen = false,
}: {
  task: Task;
  canEdit: boolean;
  mySeconds: number | null;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen && canEdit);
  const estimate = estimateOf(task);
  const row = timeRow(task.timeSpentSeconds, estimate, mySeconds);
  const timed = task.timeSpentSeconds > 0;
  const hasAny = estimate != null || timed;
  const spoken = [row.tracked, row.estimate, row.mine].filter(Boolean).join(", ");
  const value: ReactNode = !hasAny ? (
    "Add estimate"
  ) : timed ? (
    <span className="whitespace-nowrap tabular-nums">
      {row.tracked}
      {row.estimate ? <span className="text-muted-foreground"> {row.estimate}</span> : null}
    </span>
  ) : (
    <span className="whitespace-nowrap tabular-nums">~{formatMinutes(estimate as number)}</span>
  );
  return (
    <div className="flex min-w-0 flex-col items-start">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild disabled={!canEdit}>
          <PropertyValue
            empty={!hasAny}
            icon={<Timer />}
            aria-label={hasAny ? `Estimate: ${spoken}` : "Estimate: add one"}
          >
            {value}
          </PropertyValue>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-3">
          <EstimateEditor task={task} onDone={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
      {/* The bar and "you 50m" share a line of their own under the value, so
          the value never breaks (checkpoint 1, AC1.16). */}
      {timed && (row.progress !== null || row.mine) ? (
        <span className="mb-1 ml-6 flex items-center gap-2">
          {row.progress !== null ? (
            <span aria-hidden className="block h-0.5 w-16 overflow-hidden rounded-full bg-hairline">
              <span
                className={cn("block h-full bg-muted-foreground", progressWidth(row.progress))}
              />
            </span>
          ) : null}
          {row.mine ? (
            <span aria-hidden className="font-sans text-xs text-muted-foreground tabular-nums">
              {row.mine}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/** Snap the bar to twelfths: token-routed widths, no inline style (R10). */
function progressWidth(progress: number): string {
  const steps = [
    "w-0",
    "w-1/12",
    "w-2/12",
    "w-3/12",
    "w-4/12",
    "w-5/12",
    "w-6/12",
    "w-7/12",
    "w-8/12",
    "w-9/12",
    "w-10/12",
    "w-11/12",
    "w-full",
  ];
  const i = Math.round(Math.max(0, Math.min(1, progress)) * 12);
  // A started task never looks empty.
  return steps[progress > 0 && i === 0 ? 1 : i] as string;
}

/**
 * The estimate (presets or typed) and the tracked total. Typing a tracked
 * total records one adjustment that makes the total exactly that (TV-D3
 * `set_total`); a field left as it was writes nothing.
 */
function EstimateEditor({ task, onDone }: { task: Task; onDone: () => void }) {
  const { patchTask, setTimeSpent } = useTaskCommands();
  // What each field last showed as saved: Focus can save while the editor is
  // open, and a field left alone must never write back an older total.
  const baseline = useRef({
    estimate: estimateOf(task) != null ? formatMinutes(estimateOf(task) as number) : "",
    tracked: formatTracked(task.timeSpentSeconds),
  });
  const [estimate, setEstimate] = useState(baseline.current.estimate);
  const [tracked, setTracked] = useState(baseline.current.tracked);
  // A total that moves while the editor is open ("Add time…", Focus) shows in
  // the field as long as nobody is typing there; the new baseline means a
  // field left alone still writes nothing (TV-D14).
  const shownTotal = formatTracked(task.timeSpentSeconds);
  useEffect(() => {
    if (shownTotal === baseline.current.tracked) return;
    setTracked((typed) => {
      if (typed !== baseline.current.tracked) return typed;
      baseline.current.tracked = shownTotal;
      return shownTotal;
    });
  }, [shownTotal]);

  const saveEstimate = (minutes: number | null) => {
    const next = minutes && minutes > 0 ? minutes : null;
    baseline.current.estimate = next ? formatMinutes(next) : "";
    setEstimate(baseline.current.estimate);
    if (next !== estimateOf(task)) patchTask(task.id, { estimateMinutes: next });
  };
  const commitEstimate = () => {
    const typed = estimate.trim();
    if (typed === baseline.current.estimate) return;
    const minutes = typed === "" ? null : parseMinutes(typed);
    if (typed !== "" && minutes === null) {
      setEstimate(baseline.current.estimate);
      return;
    }
    saveEstimate(minutes);
  };
  const commitTracked = () => {
    const typed = tracked.trim();
    if (typed === baseline.current.tracked) return;
    const minutes = typed === "" ? 0 : parseMinutes(typed);
    if (minutes === null) {
      setTracked(baseline.current.tracked);
      return;
    }
    baseline.current.tracked = typed;
    setTimeSpent(task.id, minutes * 60);
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitEstimate();
      commitTracked();
      onDone();
    }
  };
  const current = estimateOf(task);
  return (
    <div className="flex flex-col gap-2 font-sans text-sm">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Estimate presets">
        {ESTIMATE_PRESETS.map((m) => (
          <Button
            key={m}
            size="sm"
            variant={current === m ? "secondary" : "ghost"}
            aria-pressed={current === m}
            onClick={() => {
              saveEstimate(m);
              onDone();
            }}
          >
            {formatMinutes(m)}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
        <label htmlFor="task-time-estimate" className="text-muted-foreground">
          Estimate
        </label>
        <Input
          id="task-time-estimate"
          size="sm"
          value={estimate}
          placeholder="e.g. 1h 30m"
          onChange={(e) => setEstimate(e.target.value)}
          onBlur={commitEstimate}
          onKeyDown={onKey}
        />
        <label htmlFor="task-time-tracked" className="text-muted-foreground">
          Tracked
        </label>
        <Input
          id="task-time-tracked"
          size="sm"
          value={tracked}
          placeholder="0m"
          onChange={(e) => setTracked(e.target.value)}
          onBlur={commitTracked}
          onKeyDown={onKey}
        />
      </div>
      {/* "Add time…" and your own entries (TV-D14). */}
      <TaskTimeEntries task={task} />
    </div>
  );
}

// ── Repeat ────────────────────────────────────────────────────────────────────

/** The preset a rule is, or null for anything Custom. */
function presetOf(task: Task): RecurrencePreset | null {
  if (!task.recurrence || task.recurrence.mode) return null;
  return (
    RECURRENCE_PRESETS.find(
      (p) => recurrenceFromPreset(p.value, task.scheduledAt).rrule === task.recurrence?.rrule,
    )?.value ?? null
  );
}

export function RepeatValue({
  task,
  canEdit,
  defaultOpen = false,
}: {
  task: Task;
  canEdit: boolean;
  defaultOpen?: boolean;
}) {
  const { patchTask, skipOccurrence } = useTaskCommands();
  const [open, setOpen] = useState(defaultOpen && canEdit);
  const [custom, setCustom] = useState(false);
  const label = task.recurrence ? repeatSummary(task.recurrence) : "Doesn’t repeat";
  const preset = presetOf(task);
  const anchor = task.scheduledAt ?? task.dueDate;
  const setRule = (next: Task["recurrence"]) => {
    if (!next) {
      // Clearing the rule keeps the task and its current occurrence (one-off).
      patchTask(task.id, { recurrence: null });
      return;
    }
    // A task with no date takes the rule's first occurrence as its due date
    // (the occurrence is the task's date in the one-task model).
    patchTask(
      task.id,
      task.scheduledAt || task.dueDate
        ? { recurrence: next }
        : { recurrence: next, dueDate: next.nextOccurrence },
    );
  };
  const canSkip = canEdit && !!task.recurrence && isOpenTask(task);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setCustom(false);
      }}
    >
      <PopoverTrigger asChild disabled={!canEdit}>
        <PropertyValue empty={!task.recurrence} icon={<Repeat />} aria-label={`Repeat: ${label}`}>
          {label}
        </PropertyValue>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn("p-1", custom ? "w-80" : "w-56")}>
        {custom ? (
          <CustomRepeat
            initial={defaultSpec(task.recurrence)}
            onCancel={() => setCustom(false)}
            onSave={(spec) => {
              setRule(ruleFromSpec(spec, anchor));
              setCustom(false);
              setOpen(false);
            }}
          />
        ) : (
          <div className="flex flex-col" role="menu" aria-label="Repeat">
            <RepeatOption
              selected={!task.recurrence}
              onClick={() => {
                setRule(null);
                setOpen(false);
              }}
            >
              Doesn’t repeat
            </RepeatOption>
            {RECURRENCE_PRESETS.map((p) => (
              <RepeatOption
                key={p.value}
                selected={preset === p.value}
                onClick={() => {
                  setRule(recurrenceFromPreset(p.value, anchor));
                  setOpen(false);
                }}
              >
                {p.label}
              </RepeatOption>
            ))}
            <RepeatOption selected={!!task.recurrence && !preset} onClick={() => setCustom(true)}>
              {task.recurrence && !preset ? `Custom · ${label}` : "Custom…"}
            </RepeatOption>
            {canSkip ? (
              <>
                <span aria-hidden className="my-1 h-px bg-hairline" />
                <RepeatOption
                  onClick={() => {
                    skipOccurrence(task.id);
                    setOpen(false);
                  }}
                >
                  <SkipForward className="size-icon-sm text-muted-foreground" aria-hidden />
                  Skip this occurrence
                </RepeatOption>
              </>
            ) : null}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * A repeat's cycles (TV-D12's history; TV-U13b): a quiet "4 done · last Oct 10"
 * beside the rule, opening each cycle, newest first — who closed it, and your
 * own time in it (nobody sees anyone else's). Read when opened; viewers too.
 */
export function RepeatHistory({ task }: { task: Task }) {
  const { taskHistory } = useTaskCommands();
  const completions = useTasksSelector((_, snap) => snap.completions);
  const [open, setOpen] = useState(false);
  const [cycles, setCycles] = useState<TaskCycle[] | null>(null);
  const [failed, setFailed] = useState(false);
  const { byId, currentUserId } = useAssignees();
  const summary = historySummary(completions, task.id);
  // Read on open, and again when a cycle closes while it's open.
  const doneCount = completions.filter((c) => c.taskId === task.id && !c.deletedAt).length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a cycle closing (doneCount) re-reads it.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setFailed(false);
    taskHistory(task.id)
      .then((rows) => {
        if (live) setCycles(rows);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [open, task.id, taskHistory, doneCount]);
  const nameOf = (id: string) => {
    const person = byId(id);
    const name = person?.fullName || person?.name || "";
    return name ? (name.trim().split(/\s+/)[0] ?? name) : null;
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Repeat history: ${summary}`}
          className={cn(
            "inline-flex min-h-(--ctrl-h-sm) items-center gap-1.5 rounded-md px-1.5 font-sans text-sm text-muted-foreground",
            "transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:bg-state-active",
          )}
        >
          <History className="size-icon-sm shrink-0" aria-hidden />
          {summary}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1">
        <p className="px-2 pt-1 pb-0.5 font-sans text-xs text-muted-foreground">
          Each cycle, newest first. Only your own time shows.
        </p>
        {failed ? (
          <p className="px-2 py-1.5 font-sans text-sm text-muted-foreground">
            Couldn’t load the history.
          </p>
        ) : cycles === null ? (
          <p className="px-2 py-1.5 font-sans text-sm text-muted-foreground">Loading…</p>
        ) : cycles.length === 0 ? (
          <p className="px-2 py-1.5 font-sans text-sm text-muted-foreground">
            No cycle done or skipped yet.
          </p>
        ) : (
          <ul aria-label="Cycles" className="flex max-h-64 flex-col overflow-y-auto">
            {cycles.map((c) => {
              const line = cycleLine(c, currentUserId, nameOf);
              return (
                <li
                  key={`${c.kind}-${c.at}`}
                  className="flex min-h-(--ctrl-h-sm) items-baseline gap-2 rounded-md px-2 py-0.5 font-sans text-sm"
                >
                  <span className="w-14 shrink-0 text-muted-foreground tabular-nums">
                    {line.day}
                  </span>
                  <span className="min-w-0 flex-1 break-words">
                    {line.what}
                    {line.mine ? (
                      <span className="text-muted-foreground"> · {line.mine}</span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function RepeatOption({
  selected = false,
  onClick,
  children,
}: {
  selected?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "flex min-h-(--ctrl-h-sm) items-center gap-2 rounded-md px-2 text-left font-sans text-sm",
        "transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        selected && "bg-state-selected",
      )}
    >
      {children}
    </button>
  );
}

const FREQUENCY_LABELS: Record<RepeatFrequency, string> = {
  daily: "days",
  weekly: "weeks",
  monthly: "months",
  yearly: "years",
};
const WEEKDAY_LETTER: Record<WeekdayCode, string> = {
  MO: "M",
  TU: "T",
  WE: "W",
  TH: "T",
  FR: "F",
  SA: "S",
  SU: "S",
};
const WEEKDAY_FULL: Record<WeekdayCode, string> = {
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
  SU: "Sunday",
};

/** Custom (27a–b): every n units, days, the nth weekday, an end, the mode; one summary line. */
function CustomRepeat({
  initial,
  onSave,
  onCancel,
}: {
  initial: RepeatSpec;
  onSave: (spec: RepeatSpec) => void;
  onCancel: () => void;
}) {
  const [spec, setSpec] = useState<RepeatSpec>(initial);
  const set = (patch: Partial<RepeatSpec>) => setSpec((s) => ({ ...s, ...patch }));
  const summary = repeatSummary(ruleFromSpec(spec));
  return (
    <div className="flex flex-col gap-3 p-2 font-sans text-sm">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Every</span>
        <Input
          size="sm"
          inputMode="numeric"
          aria-label="Interval"
          className="w-14"
          value={String(spec.interval)}
          onChange={(e) => {
            const n = Number(e.target.value.replace(/\D/g, ""));
            set({ interval: Number.isFinite(n) && n > 0 ? Math.min(n, 999) : 1 });
          }}
        />
        <Select
          value={spec.frequency}
          onValueChange={(v) => set({ frequency: v as RepeatFrequency })}
        >
          <SelectTrigger size="sm" aria-label="Frequency" className="w-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(FREQUENCY_LABELS) as RepeatFrequency[]).map((f) => (
              <SelectItem key={f} value={f}>
                {FREQUENCY_LABELS[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {spec.frequency === "weekly" ? (
        <div className="flex gap-1" role="group" aria-label="On these days">
          {WEEKDAYS.map((d) => {
            const on = spec.weekdays.includes(d);
            return (
              <Button
                key={d}
                size="sm"
                variant={on ? "secondary" : "ghost"}
                aria-pressed={on}
                aria-label={WEEKDAY_FULL[d]}
                className="w-(--ctrl-h-sm) px-0"
                onClick={() =>
                  set({
                    weekdays: on ? spec.weekdays.filter((x) => x !== d) : [...spec.weekdays, d],
                  })
                }
              >
                {WEEKDAY_LETTER[d]}
              </Button>
            );
          })}
        </div>
      ) : null}
      {spec.frequency === "monthly" ? (
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            size="sm"
            aria-label="Monthly on"
            value={spec.monthly.kind}
            onValueChange={(v) =>
              set({
                monthly:
                  v === "nth"
                    ? { kind: "nth", nth: 1, weekday: "MO" }
                    : { kind: "day", day: new Date().getDate() },
              })
            }
            items={[
              { value: "day", label: "On a day" },
              { value: "nth", label: "On a weekday" },
            ]}
          />
          {spec.monthly.kind === "day" ? (
            <Input
              size="sm"
              inputMode="numeric"
              aria-label="Day of the month"
              className="w-14"
              value={String(spec.monthly.day)}
              onChange={(e) => {
                const n = Number(e.target.value.replace(/\D/g, ""));
                set({ monthly: { kind: "day", day: n >= 1 && n <= 31 ? n : 1 } });
              }}
            />
          ) : (
            <>
              <Select
                value={String(spec.monthly.nth)}
                onValueChange={(v) =>
                  spec.monthly.kind === "nth" &&
                  set({ monthly: { ...spec.monthly, nth: Number(v) } })
                }
              >
                <SelectTrigger size="sm" aria-label="Which" className="w-auto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, -1].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n === -1 ? "Last" : ["", "1st", "2nd", "3rd", "4th"][n]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={spec.monthly.weekday}
                onValueChange={(v) =>
                  spec.monthly.kind === "nth" &&
                  set({ monthly: { ...spec.monthly, weekday: v as WeekdayCode } })
                }
              >
                <SelectTrigger size="sm" aria-label="Weekday" className="w-auto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {WEEKDAY_FULL[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">Ends</span>
        <Select
          value={spec.end.kind}
          onValueChange={(v) =>
            set({
              end:
                v === "until"
                  ? {
                      kind: "until",
                      day: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
                    }
                  : v === "count"
                    ? { kind: "count", count: 10 }
                    : { kind: "never" },
            })
          }
        >
          <SelectTrigger size="sm" aria-label="Ends" className="w-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="never">Never</SelectItem>
            <SelectItem value="until">On a date</SelectItem>
            <SelectItem value="count">After a number of times</SelectItem>
          </SelectContent>
        </Select>
        {spec.end.kind === "until" ? (
          // In place, not a popover inside this one (it would lose its clicks).
          <Calendar
            mode="single"
            aria-label="Last day"
            selected={new Date(`${spec.end.day}T12:00:00`)}
            defaultMonth={new Date(`${spec.end.day}T12:00:00`)}
            onSelect={(d) => {
              if (!d) return;
              const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
              set({ end: { kind: "until", day } });
            }}
          />
        ) : spec.end.kind === "count" ? (
          <Input
            size="sm"
            inputMode="numeric"
            aria-label="Times"
            className="w-16"
            value={String(spec.end.count)}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/\D/g, ""));
              set({ end: { kind: "count", count: n > 0 ? Math.min(n, 999) : 1 } });
            }}
          />
        ) : null}
      </div>
      <label className="flex items-center gap-2">
        <Checkbox
          checked={spec.afterCompletion}
          onCheckedChange={(v) => set({ afterCompletion: v === true })}
        />
        Count from when it’s done
      </label>
      <p className="font-sans text-sm text-foreground" aria-live="polite">
        {summary}
      </p>
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Back
        </Button>
        <Button size="sm" onClick={() => onSave(spec)}>
          Save
        </Button>
      </div>
    </div>
  );
}

/** An assignee as the session picker names them. */
export function personLabel(a: Assignee | null): ReactNode {
  if (!a) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <AssigneeAvatar assignee={a} size="icon" />
      {a.fullName || a.name}
    </span>
  );
}
