// The detail panel's time pickers (Tasks v3 §9, calls 24, 25, 27i, 75):
// - Due time: an optional clock time beside the due date (the assignee's).
// - Scheduled: the task's work sessions ("Thu 2:00 PM · 1h", then "+2"),
//   each for you or the assignee (TV-D10-fix), with "Add session".
// - Reminder: your own reminders — at a time, or a day / an hour before due.
// - Estimate: 15m · 30m · 45m · 1h · 2h · 4h or typed; once timed, "1h 20m of
//   ~4h" on one line with the bar on its own line under it.
// - Repeat: presets, Custom, and always one plain summary line.
// Each value is the kit's PropertyValue opening one popover.

import type { TaskReminderKind } from "@contracts/vocabularies";
import { isOpenTask } from "@contracts/vocabularies";
import { Bell, CalendarClock, Clock, Plus, Repeat, SkipForward, Timer, X } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import { DateField, formatTimeText, TimeInput } from "../../../components/ui/date-field";
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
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import { estimateOf, type Task, type TaskReminder, type TaskSession } from "../model";
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
import { formatMinutes, formatTracked, parseMinutes, timeRow } from "../time-format";
import { AssigneeAvatar } from "./assignee-avatar";

// ── Due time ──────────────────────────────────────────────────────────────────

/** The due date's optional clock time: "3:00 PM", or a quiet "Add time". */
export function DueTimeValue({
  task,
  api,
  canEdit,
}: {
  task: Task;
  api: TasksModuleApi;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const time = task.dueTime ? task.dueTime.slice(0, 5) : "";
  if (!task.dueDate || (!canEdit && !time)) return null;
  const save = (hhmm: string | null) => {
    if ((hhmm ?? "") !== time) api.patchTask(task.id, { dueTime: hhmm });
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

export function SessionsValue({
  task,
  sessions,
  api,
  canEdit,
  me,
  assignee,
  defaultOpen = false,
}: {
  task: Task;
  sessions: TaskSession[];
  api: TasksModuleApi;
  canEdit: boolean;
  me: Assignee | null;
  assignee: Assignee | null;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen && canEdit);
  const shown = shownSession(sessions);
  const more = sessions.length - 1;
  const sorted = [...sessions].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return (
    <Popover open={open} onOpenChange={setOpen}>
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
        {sorted.length > 0 ? (
          <ul className="flex flex-col p-1" aria-label="Sessions">
            {sorted.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                canEdit={canEdit}
                me={me}
                onMove={(patch) => api.updateSession(s.id, patch)}
                onRemove={() => api.removeSession(s.id)}
              />
            ))}
          </ul>
        ) : null}
        {canEdit ? (
          <AddSession
            task={task}
            me={me}
            assignee={assignee}
            divided={sorted.length > 0}
            onAdd={(input) => api.addSession(task.id, input)}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function SessionRow({
  session,
  canEdit,
  me,
  onMove,
  onRemove,
}: {
  session: TaskSession;
  canEdit: boolean;
  me: Assignee | null;
  onMove: (patch: { startsAt?: string; endsAt?: string }) => void;
  onRemove: () => void;
}) {
  const minutes = sessionMinutes(session);
  const someoneElse = session.userId && session.userId !== me?.userId;
  return (
    <li className="group flex min-h-(--ctrl-h-sm) items-center gap-1.5 rounded-md px-1.5 font-sans text-sm hover:bg-state-hover">
      <DateField
        withTime
        value={new Date(session.startsAt)}
        disabled={!canEdit}
        aria-label="Session start"
        className="-ml-1 px-1"
        onChange={(start) => {
          if (!start) return;
          // Moving keeps its length and its person.
          onMove({
            startsAt: start.toISOString(),
            endsAt: new Date(start.getTime() + minutes * 60000).toISOString(),
          });
        }}
      />
      <Select
        value={String(minutes)}
        disabled={!canEdit}
        onValueChange={(v) =>
          onMove({
            endsAt: new Date(Date.parse(session.startsAt) + Number(v) * 60000).toISOString(),
          })
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

/** A new session: when, how long, and whose (you or the assignee; nobody else). */
function AddSession({
  task,
  me,
  assignee,
  divided,
  onAdd,
}: {
  task: Task;
  me: Assignee | null;
  assignee: Assignee | null;
  divided: boolean;
  onAdd: (input: { startsAt: string; endsAt: string; userId: string | null }) => void;
}) {
  const [start, setStart] = useState<Date | null>(null);
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
    setStart(null);
  };
  return (
    <div className={cn("flex flex-col gap-2 p-2", divided && "border-t border-hairline")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <DateField
          withTime
          variant="outline"
          value={start}
          onChange={setStart}
          placeholder="Pick a time"
          aria-label="New session start"
        />
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
            { value: "me", label: "Mine" },
            { value: "assignee", label: `${otherAssignee.fullName || otherAssignee.name}’s` },
          ]}
        />
      ) : null}
      <Button size="sm" variant="secondary" disabled={!start} onClick={add} className="self-start">
        <Plus aria-hidden />
        Add session
      </Button>
    </div>
  );
}

// ── Reminder (your own) ───────────────────────────────────────────────────────

/** "1 day before due" · "Oct 14, 3:00 PM". */
export function reminderLabel(r: Pick<TaskReminder, "kind" | "at">, now = new Date()): string {
  if (r.kind === "day_before") return "1 day before due";
  if (r.kind === "hour_before") return "1 hour before due";
  return r.at ? formatDayTime(r.at, now) : "Reminder";
}

export function ReminderValue({
  task,
  reminders,
  api,
  defaultOpen = false,
}: {
  task: Task;
  reminders: TaskReminder[];
  api: TasksModuleApi;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [at, setAt] = useState<Date | null>(null);
  const first = reminders[0] ?? null;
  const has = (kind: TaskReminderKind) => reminders.some((r) => r.kind === kind);
  const add = (kind: TaskReminderKind, when: string | null = null) => {
    api.addReminder(task.id, kind, when);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <PropertyValue
          empty={!first}
          icon={<Bell />}
          aria-label={first ? `Reminder: ${reminderLabel(first)}` : "Reminder: add one"}
          trailing={
            reminders.length > 1 ? (
              <span className="shrink-0 font-sans text-xs text-muted-foreground tabular-nums">
                +{reminders.length - 1}
              </span>
            ) : null
          }
        >
          {first ? reminderLabel(first) : "Remind me"}
        </PropertyValue>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        {reminders.length > 0 ? (
          <ul aria-label="Your reminders" className="border-b border-hairline pb-1">
            {reminders.map((r) => (
              <li
                key={r.id}
                className="group flex min-h-(--ctrl-h-sm) items-center gap-2 rounded-md px-2 font-sans text-sm hover:bg-state-hover"
              >
                <Bell className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 break-words">{reminderLabel(r)}</span>
                <IconButton
                  icon={X}
                  label="Remove reminder"
                  onClick={() => api.removeReminder(r.id)}
                  className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                />
              </li>
            ))}
          </ul>
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
          <div className="flex items-center gap-1.5 px-1 pt-1">
            <DateField
              withTime
              variant="outline"
              value={at}
              onChange={setAt}
              placeholder="At a time…"
              aria-label="Remind me at"
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={!at}
              onClick={() => {
                if (!at) return;
                add("at", at.toISOString());
                setAt(null);
              }}
            >
              Add
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
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
  api,
  canEdit,
  mySeconds,
  defaultOpen = false,
}: {
  task: Task;
  api: TasksModuleApi;
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
            trailing={
              row.mine ? (
                <span className="shrink-0 font-sans text-xs text-muted-foreground tabular-nums">
                  {row.mine}
                </span>
              ) : null
            }
          >
            {value}
          </PropertyValue>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-3">
          <EstimateEditor task={task} api={api} onDone={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
      {timed && row.progress !== null ? (
        <span
          aria-hidden
          className="mt-0.5 mb-1 ml-6 block h-0.5 w-16 overflow-hidden rounded-full bg-hairline"
        >
          <span className={cn("block h-full bg-muted-foreground", progressWidth(row.progress))} />
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
function EstimateEditor({
  task,
  api,
  onDone,
}: {
  task: Task;
  api: TasksModuleApi;
  onDone: () => void;
}) {
  // What each field last showed as saved: Focus can save while the editor is
  // open, and a field left alone must never write back an older total.
  const baseline = useRef({
    estimate: estimateOf(task) != null ? formatMinutes(estimateOf(task) as number) : "",
    tracked: formatTracked(task.timeSpentSeconds),
  });
  const [estimate, setEstimate] = useState(baseline.current.estimate);
  const [tracked, setTracked] = useState(baseline.current.tracked);

  const saveEstimate = (minutes: number | null) => {
    const next = minutes && minutes > 0 ? minutes : null;
    baseline.current.estimate = next ? formatMinutes(next) : "";
    setEstimate(baseline.current.estimate);
    if (next !== estimateOf(task)) api.patchTask(task.id, { estimateMinutes: next });
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
    api.setTimeSpent(task.id, minutes * 60);
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
  api,
  canEdit,
  defaultOpen = false,
}: {
  task: Task;
  api: TasksModuleApi;
  canEdit: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen && canEdit);
  const [custom, setCustom] = useState(false);
  const label = task.recurrence ? repeatSummary(task.recurrence) : "Doesn’t repeat";
  const preset = presetOf(task);
  const anchor = task.scheduledAt ?? task.dueDate;
  const setRule = (next: Task["recurrence"]) => {
    if (!next) {
      // Clearing the rule keeps the task and its current occurrence (one-off).
      api.patchTask(task.id, { recurrence: null });
      return;
    }
    // A task with no date takes the rule's first occurrence as its due date
    // (the occurrence is the task's date in the one-task model).
    api.patchTask(
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
                    api.skipOccurrence(task.id);
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
          <DateField
            variant="outline"
            value={new Date(`${spec.end.day}T12:00:00`)}
            onChange={(d) =>
              d &&
              set({
                end: {
                  kind: "until",
                  day: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
                },
              })
            }
            aria-label="Last day"
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
