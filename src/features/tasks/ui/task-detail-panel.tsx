// Right-rail task inspector: shows the selected task's editable description and
// all of its properties, plus ambient mirrors (drift, reschedule count) and
// created/updated metadata. Mutations go through api.patchTask (optimistic) —
// no new write paths. Mirrors, never walls: ambient info is factual and quiet,
// never red / alarming (spec §10 design principles 4 & 5).

import { useEffect, useState } from "react";
import {
  CalendarClock,
  CircleDashed,
  Clock,
  CornerDownRight,
  Hourglass,
  Inbox,
  Plus,
  Repeat,
  RotateCcw,
  SkipForward,
  Sunrise,
  X,
} from "lucide-react";

import { Button } from "../../../components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../../components/ui/command";
import { Input } from "../../../components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/popover";
import { TagChip } from "../../../components/tag-chip";
import { TagPicker } from "../../../components/tag-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Separator } from "../../../components/ui/separator";
import { Textarea } from "../../../components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import {
  formatTimestamp,
  LEVEL_OPTIONS,
  STATUS_LABELS,
  toDateInputValue,
  toLocalInputValue,
  wouldCreateCycle,
} from "../helpers";
import {
  isDrifted,
  type Bucket,
  type EnergyLevel,
  type PriorityLevel,
  type Task,
  type TaskStatus,
} from "../model";
import {
  RECURRENCE_PRESETS,
  recurrenceFromPreset,
  recurrenceLabel,
  type RecurrencePreset,
} from "../parse/recurrence";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import { CompleteToggle } from "./task-row";

type Props = {
  task: Task | null;
  buckets: Bucket[];
  inbox: Bucket | null;
  canEdit: boolean;
  onRequestCapture: () => void;
  /** Move the app-level task selection (subtask ↔ parent navigation). */
  onSelectTask: (id: string) => void;
  api: TasksModuleApi;
};

// Lifecycle order for the status picker (distinct from helpers' STATUS_ORDER,
// which is the open-work-first grouping order).
const STATUS_OPTIONS: TaskStatus[] = ["todo", "in_progress", "done", "archived"];

export function TaskDetailPanel({
  task,
  buckets,
  inbox,
  canEdit,
  onRequestCapture,
  onSelectTask,
  api,
}: Props) {
  if (!task) return <DetailEmptyState canEdit={canEdit} onRequestCapture={onRequestCapture} />;
  // Key on id so every local draft (title / description / duration) resets when
  // the selection changes.
  return (
    <DetailBody
      key={task.id}
      task={task}
      buckets={buckets}
      inbox={inbox}
      canEdit={canEdit}
      onSelectTask={onSelectTask}
      api={api}
    />
  );
}

function DetailBody({
  task,
  buckets,
  inbox,
  canEdit,
  onSelectTask,
  api,
}: {
  task: Task;
  buckets: Bucket[];
  inbox: Bucket | null;
  canEdit: boolean;
  onSelectTask: (id: string) => void;
  api: TasksModuleApi;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [duration, setDuration] = useState(task.durationMinutes != null ? String(task.durationMinutes) : "");
  const [scheduled, setScheduled] = useState(toLocalInputValue(task.scheduledAt));
  const [due, setDue] = useState(toDateInputValue(task.dueDate));

  // The scheduled time also moves outside this input (skip-occurrence,
  // recurrence catch-up) — keep the draft in step with the task.
  useEffect(() => {
    setScheduled(toLocalInputValue(task.scheduledAt));
  }, [task.scheduledAt]);

  const drifted = isDrifted(task);
  const committed = !!task.committedFor && task.committedFor === api.today;
  const bucketOptions = inbox ? [inbox, ...buckets.filter((b) => b.id !== inbox.id)] : buckets;
  const taskTags = api.tagsByTask.get(task.id) ?? [];
  // Subtasks, one level (spec §11): a live parent makes this a subtask; only
  // top-level tasks offer the subtask list / add affordance.
  const parent = task.parentId ? api.tasks.find((t) => t.id === task.parentId) ?? null : null;
  const subtasks = api.subtasksByParent.get(task.id) ?? [];
  // Blocked-by dependencies (spec §5c): edges, computed blocked state.
  const blockers = api.blockersByTask.get(task.id) ?? [];
  const dependents = api.dependentsByTask.get(task.id) ?? [];
  const blocked = api.blockedTaskIds.has(task.id);
  const openBlockers = blockers.filter((b) => b.status !== "done" && b.status !== "archived");

  const commitTitle = () => {
    const next = title.trim();
    if (next && next !== task.title) api.patchTask(task.id, { title: next });
    else if (!next) setTitle(task.title); // refuse empty — restore
  };
  const commitDescription = () => {
    if (description !== task.description) api.patchTask(task.id, { description });
  };
  const commitDuration = () => {
    const n = Number.parseInt(duration, 10);
    const next = Number.isFinite(n) && n > 0 ? n : null;
    if (next !== task.durationMinutes) api.patchTask(task.id, { durationMinutes: next });
  };
  // Date fields commit on blur (not per segment-change — each patch is a network
  // upsert) and tolerate clearing: empty input → null.
  const commitScheduled = () => {
    const next = scheduled ? new Date(scheduled).toISOString() : null;
    if (next !== task.scheduledAt) api.patchTask(task.id, { scheduledAt: next });
  };
  const commitDue = () => {
    const next = due ? new Date(`${due}T00:00:00`).toISOString() : null;
    if (next !== task.dueDate) api.patchTask(task.id, { dueDate: next });
  };

  // Recurrence (spec §5d): the current rule mapped back to a preset for the
  // picker; a parsed rule outside the vocabulary reads as "custom".
  const recurrencePreset: string = task.recurrence
    ? RECURRENCE_PRESETS.find(
        (p) => recurrenceFromPreset(p.value, task.scheduledAt).rrule === task.recurrence?.rrule,
      )?.value ?? "custom"
    : "none";
  const setRecurrencePreset = (v: string) => {
    if (v === "custom" || v === recurrencePreset) return;
    if (v === "none") {
      // Clearing the rule keeps the task and its current occurrence (one-off).
      api.patchTask(task.id, { recurrence: null });
      return;
    }
    const rec = recurrenceFromPreset(v as RecurrencePreset, task.scheduledAt);
    // A task without a scheduled time adopts the rule's first occurrence —
    // the occurrence IS the scheduled time in the single-row model.
    api.patchTask(
      task.id,
      task.scheduledAt ? { recurrence: rec } : { recurrence: rec, scheduledAt: rec.nextOccurrence },
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
        {/* title + complete */}
        <Input
          value={title}
          disabled={!canEdit}
          aria-label="Task title"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              setTitle(task.title);
              e.currentTarget.blur();
            }
          }}
          className="border-transparent bg-transparent px-0 font-display text-base text-foreground"
        />

        {/* sub-task of — quiet breadcrumb back to the parent (one level) */}
        {parent ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CornerDownRight className="size-3.5 shrink-0 opacity-70" aria-hidden />
            <span className="shrink-0">Sub-task of</span>
            <button
              type="button"
              onClick={() => onSelectTask(parent.id)}
              className="min-w-0 truncate underline-offset-2 hover:text-foreground hover:underline"
            >
              {parent.title || "Untitled"}
            </button>
            {canEdit ? (
              <button
                type="button"
                onClick={() => api.setTaskParent(task.id, null)}
                className="ml-auto shrink-0 text-muted-foreground/70 hover:text-foreground"
              >
                Detach
              </button>
            ) : null}
          </div>
        ) : null}

        {/* description */}
        <Field label="Description">
          <Textarea
            value={description}
            disabled={!canEdit}
            placeholder={canEdit ? "Add a description…" : undefined}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={commitDescription}
            className="min-h-16 text-sm"
          />
        </Field>

        <Separator />

        {/* properties */}
        <div className="space-y-3">
          <Field label="Status">
            <Select
              value={task.status}
              disabled={!canEdit}
              onValueChange={(v) => api.patchTask(task.id, { status: v as TaskStatus })}
            >
              <SelectTrigger size="sm" className="w-full font-display">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Bucket">
            <Select
              value={task.bucketId}
              disabled={!canEdit}
              onValueChange={(v) => {
                if (v !== task.bucketId) api.patchTask(task.id, { bucketId: v });
              }}
            >
              <SelectTrigger size="sm" className="w-full font-display">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {bucketOptions.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    <span className="flex items-center gap-2">
                      {b.isSystem ? <Inbox className="size-3.5 text-muted-foreground" aria-hidden /> : null}
                      {b.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Scheduled">
              <Input
                type="datetime-local"
                disabled={!canEdit}
                value={scheduled}
                className="h-8"
                onChange={(e) => setScheduled(e.target.value)}
                onBlur={commitScheduled}
              />
            </Field>
            <Field label="Due">
              <Input
                type="date"
                disabled={!canEdit}
                value={due}
                className="h-8"
                onChange={(e) => setDue(e.target.value)}
                onBlur={commitDue}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Priority">
              <LevelSelect
                value={task.priority}
                disabled={!canEdit}
                onChange={(v) => api.patchTask(task.id, { priority: v })}
              />
            </Field>
            <Field label="Energy">
              <LevelSelect
                value={task.energyLevel}
                disabled={!canEdit}
                onChange={(v) => api.patchTask(task.id, { energyLevel: v })}
              />
            </Field>
          </div>

          <Field label="Duration">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                inputMode="numeric"
                disabled={!canEdit}
                value={duration}
                placeholder="—"
                onChange={(e) => setDuration(e.target.value)}
                onBlur={commitDuration}
                className="h-8 w-24"
              />
              <span className="text-xs text-muted-foreground">minutes</span>
            </div>
          </Field>

          {/* recurrence — the single-row engine (spec §5d): preset vocabulary
              only (no complex picker), plus the skip-occurrence affordance */}
          <Field label="Repeat">
            <div className="flex items-center gap-2">
              <Select
                value={recurrencePreset}
                disabled={!canEdit}
                onValueChange={setRecurrencePreset}
              >
                <SelectTrigger size="sm" className="w-full font-display">
                  <span className="flex min-w-0 items-center gap-2">
                    <Repeat className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <SelectValue />
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Doesn’t repeat</SelectItem>
                  {RECURRENCE_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                  {recurrencePreset === "custom" && task.recurrence ? (
                    <SelectItem value="custom">{recurrenceLabel(task.recurrence)}</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
              {canEdit && task.recurrence && task.status !== "done" && task.status !== "archived" ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => api.skipOccurrence(task.id)}
                      aria-label="Skip this occurrence"
                    >
                      <SkipForward className="size-3.5" aria-hidden />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Skip this occurrence</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          </Field>

          <Field label="Tags">
            <div className="flex flex-wrap items-center gap-1.5">
              {taskTags.map((t) => (
                <TagChip
                  key={t.id}
                  name={t.name}
                  color={t.color}
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
                />
              ) : taskTags.length === 0 ? (
                <span className="text-xs text-muted-foreground">No tags</span>
              ) : null}
            </div>
          </Field>

          {/* subtasks — one level: only top-level tasks get the list/affordance */}
          {!parent ? (
            <SubtasksField
              task={task}
              subtasks={subtasks}
              canEdit={canEdit}
              onSelectTask={onSelectTask}
              api={api}
            />
          ) : null}

          {/* blocked-by dependencies — edges, never a stored status (spec §5c) */}
          <BlockedByField
            task={task}
            blockers={blockers}
            canEdit={canEdit}
            onSelectTask={onSelectTask}
            api={api}
          />
          {dependents.length > 0 ? (
            <Field label="Blocks">
              <div className="space-y-0.5">
                {dependents.map((d) => (
                  <RelatedTaskRow key={d.id} task={d} onSelect={() => onSelectTask(d.id)} />
                ))}
              </div>
            </Field>
          ) : null}

          {canEdit ? (
            <Button
              type="button"
              variant={committed ? "secondary" : "outline"}
              size="sm"
              className="w-full justify-center"
              onClick={() => api.toggleCommit(task.id)}
            >
              <Sunrise className="size-3.5" aria-hidden />
              {committed ? "Remove from today" : "Commit to today"}
            </Button>
          ) : null}
        </div>

        {/* ambient mirrors — quiet, factual, never alarming (principles 4 & 5) */}
        {drifted || blocked || task.rescheduleCount > 0 ? (
          <>
            <Separator />
            <div className="space-y-1.5 text-xs text-muted-foreground">
              {drifted ? (
                <Mirror icon={<Clock className="size-3.5" aria-hidden />}>
                  Drifted — its scheduled time has passed.
                </Mirror>
              ) : null}
              {blocked ? (
                <Mirror icon={<CircleDashed className="size-3.5" aria-hidden />}>
                  {openBlockers.length === 1
                    ? `Blocked — waiting on “${openBlockers[0].title || "Untitled"}”.`
                    : `Blocked — waiting on ${openBlockers.length} tasks.`}
                </Mirror>
              ) : null}
              {task.rescheduleCount > 0 ? (
                <Mirror icon={<RotateCcw className="size-3.5" aria-hidden />}>
                  Rescheduled {task.rescheduleCount}×
                </Mirror>
              ) : null}
            </div>
          </>
        ) : null}

        <Separator />

        {/* metadata */}
        <div className="space-y-1 text-2xs text-muted-foreground/80">
          <Meta term="Created" icon={<CalendarClock className="size-3 opacity-70" aria-hidden />}>
            {formatTimestamp(task.createdAt)}
          </Meta>
          <Meta term="Updated" icon={<Hourglass className="size-3 opacity-70" aria-hidden />}>
            {formatTimestamp(task.updatedAt)}
          </Meta>
        </div>
      </div>
    </div>
  );
}

// ── subtasks (one level — spec §11) ────────────────────────────────────────────

function SubtasksField({
  task,
  subtasks,
  canEdit,
  onSelectTask,
  api,
}: {
  task: Task;
  subtasks: Task[];
  canEdit: boolean;
  onSelectTask: (id: string) => void;
  api: TasksModuleApi;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const progress = api.subtaskProgressByTask.get(task.id);

  if (subtasks.length === 0 && !canEdit) return null;

  const submit = () => {
    const next = draft.trim();
    if (next) api.addSubtask(task.id, next);
    setDraft("");
  };

  return (
    <div className="space-y-1">
      <span className="flex items-baseline gap-1.5 font-display text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        Subtasks
        {progress && progress.total > 0 ? (
          // quiet n/m mirror — factual, never alarming (principles 4 & 5)
          <span className="font-sans normal-case tracking-normal text-muted-foreground/70 tabular-nums">
            {progress.done}/{progress.total}
          </span>
        ) : null}
      </span>
      {subtasks.length > 0 ? (
        <div className="space-y-0.5">
          {subtasks.map((subtask) => (
            <SubtaskRow
              key={subtask.id}
              subtask={subtask}
              canEdit={canEdit}
              onSelect={() => onSelectTask(subtask.id)}
              api={api}
            />
          ))}
        </div>
      ) : null}
      {canEdit ? (
        adding ? (
          <Input
            autoFocus
            value={draft}
            placeholder="Add a subtask…"
            aria-label="New subtask title"
            className="h-8 text-sm"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit(); // stays open for rapid entry
              } else if (e.key === "Escape") {
                setDraft("");
                setAdding(false);
              }
            }}
            onBlur={() => {
              submit();
              setAdding(false);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="size-3.5" aria-hidden />
            Add subtask
          </button>
        )
      ) : null}
    </div>
  );
}

function SubtaskRow({
  subtask,
  canEdit,
  onSelect,
  api,
}: {
  subtask: Task;
  canEdit: boolean;
  onSelect: () => void;
  api: TasksModuleApi;
}) {
  const done = subtask.status === "done";
  const committed = !!subtask.committedFor && subtask.committedFor === api.today;
  return (
    <div className="group flex min-h-7 items-center gap-2 rounded px-1 hover:bg-accent/60">
      <CompleteToggle done={done} disabled={!canEdit} onToggle={() => api.toggleDone(subtask)} />
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "min-w-0 flex-1 truncate text-left text-sm",
          done ? "text-muted-foreground line-through" : "text-foreground",
        )}
      >
        {subtask.title || "Untitled"}
      </button>
      {/* individually committable — start a scary task via its smallest step */}
      {canEdit || committed ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              disabled={!canEdit}
              aria-label={committed ? "Remove from today" : "Commit to today"}
              onClick={() => api.toggleCommit(subtask.id)}
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded transition-opacity",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:opacity-100",
                committed
                  ? "text-foreground"
                  : "text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100",
              )}
            >
              <Sunrise className="size-3.5" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {committed ? "Committed for today — click to remove" : "Commit to today"}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

// ── blocked-by dependencies (spec §5c) ─────────────────────────────────────────

function BlockedByField({
  task,
  blockers,
  canEdit,
  onSelectTask,
  api,
}: {
  task: Task;
  blockers: Task[];
  canEdit: boolean;
  onSelectTask: (id: string) => void;
  api: TasksModuleApi;
}) {
  if (blockers.length === 0 && !canEdit) return null;
  return (
    <Field label="Blocked by">
      {blockers.length > 0 ? (
        <div className="space-y-0.5">
          {blockers.map((blocker) => (
            <RelatedTaskRow
              key={blocker.id}
              task={blocker}
              onSelect={() => onSelectTask(blocker.id)}
              onRemove={canEdit ? () => api.removeBlocker(task.id, blocker.id) : undefined}
            />
          ))}
        </div>
      ) : null}
      {canEdit ? <BlockerPicker task={task} api={api} /> : null}
    </Field>
  );
}

/** A quiet related-task row: click-through title, optional ✕ (removes the
 * edge, never the task). Done blockers render struck through — inert. */
function RelatedTaskRow({
  task,
  onSelect,
  onRemove,
}: {
  task: Task;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  const done = task.status === "done" || task.status === "archived";
  return (
    <div className="group flex min-h-7 items-center gap-2 rounded px-1 hover:bg-accent/60">
      <CircleDashed className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "min-w-0 flex-1 truncate text-left text-sm",
          done ? "text-muted-foreground line-through" : "text-foreground",
        )}
      >
        {task.title || "Untitled"}
      </button>
      {onRemove ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Remove dependency"
              onClick={onRemove}
              className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent>Remove dependency (keeps the task)</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

/** Searchable picker for a new blocker: open, live tasks only; tasks that
 * would close a cycle are filtered out (the hook + DB trigger backstop). */
function BlockerPicker({ task, api }: { task: Task; api: TasksModuleApi }) {
  const [open, setOpen] = useState(false);
  const currentBlockerIds = new Set((api.blockersByTask.get(task.id) ?? []).map((b) => b.id));
  const candidates = api.tasks.filter(
    (t) =>
      t.id !== task.id &&
      t.status !== "done" &&
      t.status !== "archived" &&
      !currentBlockerIds.has(t.id) &&
      !wouldCreateCycle(t.id, task.id, api.taskRelations),
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-3.5" aria-hidden />
          Add blocker
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Blocked by…" />
          <CommandList>
            <CommandEmpty>No matching open tasks.</CommandEmpty>
            <CommandGroup>
              {candidates.map((t) => (
                <CommandItem
                  key={t.id}
                  value={`${t.title || "Untitled"} ${t.id}`}
                  onSelect={() => {
                    api.addBlocker(task.id, t.id);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{t.title || "Untitled"}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── empty / teaching state ─────────────────────────────────────────────────────

function DetailEmptyState({
  canEdit,
  onRequestCapture,
}: {
  canEdit: boolean;
  onRequestCapture: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-2 text-center">
      <p className="font-display text-sm text-foreground">No task selected</p>
      <p className="text-xs text-muted-foreground">Pick a task to see and edit its details here.</p>
      {canEdit ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Press <Kbd>c</Kbd> to{" "}
          <button
            type="button"
            onClick={onRequestCapture}
            className="underline-offset-2 hover:text-foreground hover:underline"
          >
            capture
          </button>{" "}
          a new one.
        </p>
      ) : null}
    </div>
  );
}

// ── small building blocks ──────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="block font-display text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function LevelSelect({
  value,
  disabled,
  onChange,
}: {
  value: EnergyLevel | PriorityLevel | null;
  disabled: boolean;
  onChange: (next: EnergyLevel | PriorityLevel | null) => void;
}) {
  return (
    <Select
      value={value ?? "none"}
      disabled={disabled}
      onValueChange={(v) => onChange(v === "none" ? null : (v as EnergyLevel | PriorityLevel))}
    >
      <SelectTrigger size="sm" className="w-full font-display">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">None</SelectItem>
        {LEVEL_OPTIONS.map((l) => (
          <SelectItem key={l.value} value={l.value}>
            {l.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Mirror({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="shrink-0 text-muted-foreground/70">{icon}</span>
      {children}
    </span>
  );
}

function Meta({
  term,
  icon,
  children,
}: {
  term: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 tabular-nums">
      {icon}
      <span>
        {term} {children}
      </span>
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-2xs text-muted-foreground">
      {children}
    </kbd>
  );
}
