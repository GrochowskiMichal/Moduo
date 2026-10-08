// The detail panel's properties (tasks-v2 §9, comp §1 + §5 option C). Every
// value starts at the same x behind a 14px icon slot and edits in place through
// its own quiet control (no chevrons; hover shows the field). Status, Assignee,
// Priority, Due and Tags always show; Energy, Scheduled, Time and Repeat show
// once set, and until then sit in one quiet line that names them. Picking a name
// there shows its row, empty, with its editor open.

import { format } from "date-fns";
import {
  Archive,
  CircleCheck,
  CircleDot,
  Circle as CircleIcon,
  Clock,
  Flag,
  Plus,
  Repeat,
  SkipForward,
  Timer,
  User,
  Zap,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { TagChip } from "../../../components/tag-chip";
import { TagPicker } from "../../../components/tag-picker";
import { DateField } from "../../../components/ui/date-field";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { Input } from "../../../components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { PropertyRow, PropertyValue } from "../../../components/ui/property-row";
import { cn } from "../../../lib/utils";
import {
  assigneeLabel,
  assigneeOptions,
  fromAssigneeValue,
  toAssigneeValue,
} from "../assignee-options";
import { previewAssign, useAssignees } from "../assignees";
import {
  OPTIONAL_PROPERTY_LABELS,
  type OptionalProperty,
  quietLineProperties,
  shownOptionalProperties,
} from "../detail-properties";
import { LEVEL_OPTIONS, STATUS_LABELS } from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import {
  type EnergyLevel,
  isDrifted,
  type PriorityLevel,
  type Task,
  type TaskStatus,
} from "../model";
import {
  RECURRENCE_PRESETS,
  type RecurrencePreset,
  recurrenceFromPreset,
  recurrenceLabel,
} from "../parse/recurrence";
import { formatMinutes, formatTracked, parseMinutes, timeRow } from "../time-format";
import { AssigneeAvatar } from "./assignee-avatar";
import { EnergyIcon, PriorityIcon } from "./level-icons";

// Lifecycle order for the status picker.
const STATUS_OPTIONS: TaskStatus[] = ["todo", "in_progress", "done", "archived"];

const STATUS_ICONS: Record<TaskStatus, ReactNode> = {
  todo: <CircleIcon />,
  in_progress: <CircleDot />,
  done: <CircleCheck />,
  archived: <Archive />,
};

type Props = {
  task: Task;
  api: TasksModuleApi;
  canEdit: boolean;
  /** My share of the task's tracked time (null until known). */
  mySeconds: number | null;
};

export function TaskDetailProperties({ task, api, canEdit, mySeconds }: Props) {
  // Rows picked from the quiet line stay while this task is open, even empty.
  const [revealed, setRevealed] = useState<Set<OptionalProperty>>(() => new Set());
  // The row that was just revealed opens its editor once, on mount.
  const [opening, setOpening] = useState<OptionalProperty | null>(null);
  const shown = shownOptionalProperties(task, revealed);
  const quiet = canEdit ? quietLineProperties(task, revealed) : [];
  const autoOpen = (p: OptionalProperty) => opening === p;

  const reveal = (p: OptionalProperty) => {
    setRevealed((prev) => new Set(prev).add(p));
    setOpening(p);
  };

  return (
    <div className="flex flex-col gap-px">
      <PropertyRow label="Status">
        <StatusValue task={task} api={api} canEdit={canEdit} />
      </PropertyRow>
      <PropertyRow label="Assignee">
        <AssigneeValue task={task} api={api} canEdit={canEdit} />
      </PropertyRow>
      <PropertyRow label="Priority">
        <LevelValue
          kind="priority"
          value={task.priority}
          canEdit={canEdit}
          onChange={(v) => api.patchTask(task.id, { priority: v as PriorityLevel | null })}
        />
      </PropertyRow>
      {shown.has("energy") ? (
        <PropertyRow label="Energy">
          <LevelValue
            kind="energy"
            value={task.energyLevel}
            canEdit={canEdit}
            defaultOpen={autoOpen("energy")}
            onChange={(v) => api.patchTask(task.id, { energyLevel: v as EnergyLevel | null })}
          />
        </PropertyRow>
      ) : null}
      <PropertyRow label="Due">
        <DateField
          variant="property"
          value={task.dueDate ? new Date(task.dueDate) : null}
          onChange={(d) => api.patchTask(task.id, { dueDate: d ? d.toISOString() : null })}
          formatValue={(d) => format(d, "EEE, MMM d")}
          placeholder="Set date"
          aria-label="Due"
          disabled={!canEdit}
        />
      </PropertyRow>
      {shown.has("scheduled") ? (
        <PropertyRow label="Scheduled">
          <DateField
            variant="property"
            withTime
            icon={<Clock />}
            value={task.scheduledAt ? new Date(task.scheduledAt) : null}
            onChange={(d) => api.patchTask(task.id, { scheduledAt: d ? d.toISOString() : null })}
            formatValue={(d) => format(d, "EEE, MMM d · HH:mm")}
            placeholder="Set time"
            aria-label="Scheduled"
            disabled={!canEdit}
            defaultOpen={autoOpen("scheduled")}
          />
          {/* Drift stays ambient and factual, never alarming (spec principles 4–5). */}
          {isDrifted(task) ? (
            <span className="ml-1.5 shrink-0 font-sans text-xs text-muted-foreground">passed</span>
          ) : null}
        </PropertyRow>
      ) : null}
      {shown.has("time") ? (
        <PropertyRow label="Time">
          <TimeValue
            task={task}
            api={api}
            canEdit={canEdit}
            mySeconds={mySeconds}
            defaultOpen={autoOpen("time")}
          />
        </PropertyRow>
      ) : null}
      {shown.has("repeat") ? (
        <PropertyRow label="Repeat">
          <RepeatValue task={task} api={api} canEdit={canEdit} defaultOpen={autoOpen("repeat")} />
        </PropertyRow>
      ) : null}
      <PropertyRow label="Tags" align="start">
        <TagsValue task={task} api={api} canEdit={canEdit} />
      </PropertyRow>
      {quiet.length > 0 ? (
        <div className="flex h-(--ctrl-h-sm) items-center gap-2 font-sans text-sm text-muted-foreground">
          <Plus className="size-icon-sm shrink-0" aria-hidden />
          <span className="flex min-w-0 flex-wrap items-center">
            {quiet.map((p, i) => (
              <span key={p} className="flex items-center">
                {i > 0 ? (
                  <span aria-hidden className="px-1">
                    ·
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => reveal(p)}
                  aria-label={`Add ${OPTIONAL_PROPERTY_LABELS[p].toLowerCase()}`}
                  className="rounded-sm transition-colors duration-(--motion-fade) ease-(--ease-out) hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {OPTIONAL_PROPERTY_LABELS[p]}
                </button>
              </span>
            ))}
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ── values ────────────────────────────────────────────────────────────────────

function StatusValue({
  task,
  api,
  canEdit,
}: {
  task: Task;
  api: TasksModuleApi;
  canEdit: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={!canEdit}>
        <PropertyValue
          icon={STATUS_ICONS[task.status]}
          aria-label={`Status: ${STATUS_LABELS[task.status]}`}
        >
          {STATUS_LABELS[task.status]}
        </PropertyValue>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuRadioGroup
          value={task.status}
          onValueChange={(v) => {
            if (v !== task.status) api.patchTask(task.id, { status: v as TaskStatus });
          }}
        >
          {STATUS_OPTIONS.map((s) => (
            <DropdownMenuRadioItem key={s} value={s}>
              <span className="flex size-icon-sm items-center text-muted-foreground [&_svg]:size-icon-sm">
                {STATUS_ICONS[s]}
              </span>
              {STATUS_LABELS[s]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AssigneeValue({
  task,
  api,
  canEdit,
}: {
  task: Task;
  api: TasksModuleApi;
  canEdit: boolean;
}) {
  const { assignees, byId } = useAssignees();
  const known = byId(task.assigneeId);
  // A former member reads "Former member", so the value never renders blank.
  const label = known ? known.name : assigneeLabel(task.assigneeId, byId);
  const unassigned = task.assigneeId === null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={!canEdit}>
        <PropertyValue
          empty={unassigned}
          icon={known ? <AssigneeAvatar assignee={known} className="size-icon-sm" /> : <User />}
          aria-label={`Assignee: ${label}`}
        >
          {label}
        </PropertyValue>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuRadioGroup
          value={toAssigneeValue(task.assigneeId)}
          onValueChange={(v) => {
            const id = fromAssigneeValue(v);
            if (id === task.assigneeId) return;
            if (id) {
              void previewAssign(task.bucketId, id).then((msg) => {
                if (msg) toast.message(msg);
              });
            }
            api.patchTask(task.id, { assigneeId: id });
          }}
        >
          {assigneeOptions(assignees).map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value} disabled={o.disabled}>
              {o.assignee ? (
                <AssigneeAvatar assignee={o.assignee} className="size-4" />
              ) : (
                <User className="size-4 text-muted-foreground" aria-hidden />
              )}
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const LEVEL_WORD: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };

function LevelValue({
  kind,
  value,
  canEdit,
  defaultOpen = false,
  onChange,
}: {
  kind: "priority" | "energy";
  value: EnergyLevel | PriorityLevel | null;
  canEdit: boolean;
  defaultOpen?: boolean;
  onChange: (next: EnergyLevel | PriorityLevel | null) => void;
}) {
  const name = kind === "priority" ? "Priority" : "Energy";
  const glyph = (level: EnergyLevel | PriorityLevel) =>
    kind === "priority" ? (
      <PriorityIcon level={level as PriorityLevel} className="size-icon-sm" />
    ) : (
      <EnergyIcon level={level as EnergyLevel} className="size-icon-sm" />
    );
  const emptyIcon = kind === "priority" ? <Flag /> : <Zap />;
  return (
    <DropdownMenu defaultOpen={defaultOpen && canEdit}>
      <DropdownMenuTrigger asChild disabled={!canEdit}>
        <PropertyValue
          empty={!value}
          icon={value ? glyph(value) : emptyIcon}
          aria-label={`${name}: ${value ? LEVEL_WORD[value] : "none"}`}
        >
          {value ? LEVEL_WORD[value] : `Set ${name.toLowerCase()}`}
        </PropertyValue>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuRadioGroup
          value={value ?? "none"}
          onValueChange={(v) => onChange(v === "none" ? null : (v as EnergyLevel | PriorityLevel))}
        >
          {[...LEVEL_OPTIONS].reverse().map((l) => (
            <DropdownMenuRadioItem key={l.value} value={l.value}>
              <span className="flex size-icon-sm items-center text-muted-foreground">
                {glyph(l.value)}
              </span>
              {l.label}
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuRadioItem value="none">No {name.toLowerCase()}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RepeatValue({
  task,
  api,
  canEdit,
  defaultOpen,
}: {
  task: Task;
  api: TasksModuleApi;
  canEdit: boolean;
  defaultOpen: boolean;
}) {
  // The current rule mapped back to a preset; a parsed rule outside the
  // vocabulary reads as "custom" (spec §5d: presets only, no rule builder).
  const preset: string = task.recurrence
    ? (RECURRENCE_PRESETS.find(
        (p) => recurrenceFromPreset(p.value, task.scheduledAt).rrule === task.recurrence?.rrule,
      )?.value ?? "custom")
    : "none";
  const setPreset = (v: string) => {
    if (v === "custom" || v === preset) return;
    if (v === "none") {
      // Clearing the rule keeps the task and its current occurrence (one-off).
      api.patchTask(task.id, { recurrence: null });
      return;
    }
    const rec = recurrenceFromPreset(v as RecurrencePreset, task.scheduledAt);
    // A task without a scheduled time adopts the rule's first occurrence:
    // the occurrence IS the scheduled time in the single-row model.
    api.patchTask(
      task.id,
      task.scheduledAt ? { recurrence: rec } : { recurrence: rec, scheduledAt: rec.nextOccurrence },
    );
  };
  const label = task.recurrence ? recurrenceLabel(task.recurrence) : "Doesn’t repeat";
  const canSkip =
    canEdit && !!task.recurrence && task.status !== "done" && task.status !== "archived";
  return (
    <DropdownMenu defaultOpen={defaultOpen && canEdit}>
      <DropdownMenuTrigger asChild disabled={!canEdit}>
        <PropertyValue empty={!task.recurrence} icon={<Repeat />} aria-label={`Repeat: ${label}`}>
          {label}
        </PropertyValue>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuRadioGroup value={preset} onValueChange={setPreset}>
          <DropdownMenuRadioItem value="none">Doesn’t repeat</DropdownMenuRadioItem>
          {RECURRENCE_PRESETS.map((p) => (
            <DropdownMenuRadioItem key={p.value} value={p.value}>
              {p.label}
            </DropdownMenuRadioItem>
          ))}
          {preset === "custom" && task.recurrence ? (
            <DropdownMenuRadioItem value="custom">
              {recurrenceLabel(task.recurrence)}
            </DropdownMenuRadioItem>
          ) : null}
        </DropdownMenuRadioGroup>
        {canSkip ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => api.skipOccurrence(task.id)}>
              <SkipForward aria-hidden />
              Skip this occurrence
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "1h 20m of ~4h", a hairline bar, and "you 50m" for your share (tasks-v2 §5). */
function TimeValue({
  task,
  api,
  canEdit,
  mySeconds,
  defaultOpen,
}: {
  task: Task;
  api: TasksModuleApi;
  canEdit: boolean;
  mySeconds: number | null;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen && canEdit);
  const row = timeRow(task.timeSpentSeconds, task.durationMinutes, mySeconds);
  const hasAny = task.durationMinutes != null || task.timeSpentSeconds > 0;
  const spoken = [row.tracked, row.estimate, row.mine].filter(Boolean).join(", ");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={!canEdit}>
        <PropertyValue
          empty={!hasAny}
          icon={<Timer />}
          aria-label={hasAny ? `Time: ${spoken}` : "Time: add estimate"}
          trailing={
            hasAny ? (
              <>
                {row.progress !== null ? (
                  <span
                    aria-hidden
                    className="h-0.5 w-8 shrink-0 overflow-hidden rounded-full bg-hairline"
                  >
                    <span
                      className={cn(
                        "block h-full bg-muted-foreground",
                        // The fill is the only proportional value on the row.
                        progressWidth(row.progress),
                      )}
                    />
                  </span>
                ) : null}
                {row.mine ? (
                  <span className="shrink-0 font-sans text-xs text-muted-foreground tabular-nums">
                    {row.mine}
                  </span>
                ) : null}
              </>
            ) : null
          }
        >
          {hasAny ? (
            <span className="tabular-nums">
              {row.tracked}
              {row.estimate ? <span className="text-muted-foreground"> {row.estimate}</span> : null}
            </span>
          ) : (
            "Add estimate"
          )}
        </PropertyValue>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <TimeEditor task={task} api={api} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
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
  return steps[progress > 0 && i === 0 ? 1 : i];
}

/**
 * Estimate and tracked time. Typing a tracked total records one adjustment
 * that makes the total exactly that (TV-D3 `set_total`); a field left as it was
 * writes nothing, so a glance never rounds away tracked seconds.
 */
function TimeEditor({
  task,
  api,
  onDone,
}: {
  task: Task;
  api: TasksModuleApi;
  onDone: () => void;
}) {
  const initialEstimate = task.durationMinutes != null ? formatMinutes(task.durationMinutes) : "";
  const initialTracked = formatTracked(task.timeSpentSeconds);
  const [estimate, setEstimate] = useState(initialEstimate);
  const [tracked, setTracked] = useState(initialTracked);

  const commitEstimate = () => {
    if (estimate.trim() === initialEstimate) return;
    const minutes = estimate.trim() === "" ? null : parseMinutes(estimate);
    if (estimate.trim() !== "" && minutes === null) {
      setEstimate(initialEstimate);
      return;
    }
    const next = minutes && minutes > 0 ? minutes : null;
    if (next !== task.durationMinutes) api.patchTask(task.id, { durationMinutes: next });
  };
  const commitTracked = () => {
    if (tracked.trim() === initialTracked) return;
    const minutes = tracked.trim() === "" ? 0 : parseMinutes(tracked);
    if (minutes === null) {
      setTracked(initialTracked);
      return;
    }
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

  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 font-sans text-sm">
      <label htmlFor="task-time-estimate" className="text-muted-foreground">
        Estimate
      </label>
      <Input
        id="task-time-estimate"
        size="sm"
        autoFocus
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
  );
}

function TagsValue({ task, api, canEdit }: { task: Task; api: TasksModuleApi; canEdit: boolean }) {
  const taskTags = api.tagsByTask.get(task.id) ?? [];
  return (
    <div className="flex min-h-(--ctrl-h-sm) flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
      {taskTags.map((t) => (
        <TagChip
          key={t.id}
          name={t.name}
          color={t.color}
          size="md"
          onRemove={canEdit ? () => api.toggleTaskTag(task.id, t.id) : undefined}
        />
      ))}
      {canEdit ? (
        <TagPicker
          tags={api.tags}
          selectedIds={taskTags.map((t) => t.id)}
          canEdit={canEdit}
          onToggle={(tagId) => api.toggleTaskTag(task.id, tagId)}
          onCreate={(name) => api.createTagForTask(name, task.id)}
          onRecolor={(tagId, color) => api.setTagColor(tagId, color)}
          onDelete={(tagId) => api.deleteTag(tagId)}
          trigger={
            <PropertyValue
              icon={<Plus />}
              empty
              aria-label="Add tag"
              className={cn(taskTags.length > 0 && "ml-0 px-1")}
            >
              {taskTags.length === 0 ? "Add tag" : null}
            </PropertyValue>
          }
        />
      ) : taskTags.length === 0 ? (
        <span className="font-sans text-sm text-muted-foreground">No tags</span>
      ) : null}
    </div>
  );
}
