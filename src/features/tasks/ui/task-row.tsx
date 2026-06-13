import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Clock,
  CornerDownRight,
  Inbox,
  ListChecks,
  Repeat,
} from "lucide-react";

import { Badge } from "../../../components/ui/badge";
import { CompleteToggle } from "../../../components/ui/complete-toggle";
import { TagChipList } from "../../../components/tag-chip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "../../../components/ui/context-menu";
import { Input } from "../../../components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import {
  ENERGY_LABELS,
  formatDue,
  formatScheduled,
  LEVEL_OPTIONS,
  PRIORITY_LABELS,
  toDateInputValue,
  toLocalInputValue,
} from "../helpers";
import { isDrifted, type EnergyLevel, type PriorityLevel, type Task } from "../model";
import { recurrenceLabel } from "../parse/recurrence";
import type { TasksModuleApi } from "../hooks/use-tasks-module";

/** Which inline popover the keyboard asked to open on this row. */
export type RowCommand = "bucket" | "schedule" | "due" | null;

type Props = {
  task: Task;
  bucketName: string;
  buckets: Array<{ id: string; name: string; isSystem: boolean }>;
  inboxId: string | null;
  showBucket: boolean;
  selected: boolean;
  editing: boolean;
  command: RowCommand;
  canEdit: boolean;
  onSelect: () => void;
  onStartEdit: () => void;
  onEndEdit: () => void;
  onClearCommand: () => void;
  onRequestCommand: (command: RowCommand) => void;
  /** Click a tag chip to toggle it in the view filter. */
  onTagFilter?: (tagId: string) => void;
  /**
   * Reserve the expand gutter so checkboxes stay aligned. The list turns this
   * on only when the scope actually nests subtasks (quiet until used).
   */
  expandSlot?: boolean;
  /** Subtask nesting (Session 5): this row has children → chevron + n/m mirror. */
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  /** Quiet n/m subtask progress (parents only; mirror, never a wall). */
  progress?: { done: number; total: number } | null;
  /** Render indented one level (the row is a nested subtask). */
  nested?: boolean;
  /** Parent title caption for subtasks rendered flat (Today queue, or a scope
   * that doesn't contain the parent). */
  parentTitle?: string | null;
  api: TasksModuleApi;
};

export function TaskRow({
  task,
  bucketName,
  buckets,
  inboxId,
  showBucket,
  selected,
  editing,
  command,
  canEdit,
  onSelect,
  onStartEdit,
  onEndEdit,
  onClearCommand,
  onRequestCommand,
  onTagFilter,
  expandSlot = false,
  expandable = false,
  expanded = false,
  onToggleExpand,
  progress = null,
  nested = false,
  parentTitle = null,
  api,
}: Props) {
  const done = task.status === "done";
  const drifted = isDrifted(task);
  const committed = !!task.committedFor && task.committedFor === api.today;
  const scheduled = formatScheduled(task.scheduledAt);
  const due = formatDue(task.dueDate);
  const tags = api.tagsByTask.get(task.id) ?? [];
  // Blocked — computed, ambient: dim + a quiet icon, never red (spec §5c).
  const blocked = api.blockedTaskIds.has(task.id);

  const row = (
    <div
      role="row"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "group relative flex items-center gap-2 rounded-md px-2 py-0.5 text-sm",
        "border border-transparent cursor-default select-none",
        selected ? "bg-(--selected-bg)" : "hover:bg-accent/60",
        nested && "ml-6",
      )}
      // height rides the density setting; py is only a multiline guard
      style={{ minHeight: "var(--row-h)" }}
    >
      {/* selected marker — a quiet accent bar, distinct from the lighter hover fill */}
      {selected ? (
        <span className="absolute inset-y-1 left-0.5 w-0.5 rounded-full bg-primary" aria-hidden />
      ) : null}
      {/* nested subtask indent guide — a quiet vertical hairline in the indent gutter */}
      {nested ? (
        <span className="absolute inset-y-0 -left-3 w-px bg-border/60" aria-hidden />
      ) : null}
      {expandSlot ? (
        expandable ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-expanded={expanded}
                aria-label={expanded ? "Collapse subtasks" : "Expand subtasks"}
                className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpand?.();
                }}
              >
                {expanded ? (
                  <ChevronDown className="size-3.5" aria-hidden />
                ) : (
                  <ChevronRight className="size-3.5" aria-hidden />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>{expanded ? "Collapse subtasks" : "Expand subtasks"}</TooltipContent>
          </Tooltip>
        ) : (
          <span className="size-4 shrink-0" aria-hidden />
        )
      ) : null}
      <CompleteToggle done={done} disabled={!canEdit} onToggle={() => api.toggleDone(task)} />

      {editing ? (
        <div className="min-w-0 flex-1">
          <TitleEditor
            initial={task.title}
            onCommit={(value) => {
              const next = value.trim();
              if (next && next !== task.title) api.patchTask(task.id, { title: next });
              onEndEdit();
            }}
            onCancel={onEndEdit}
          />
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            type="button"
            className={cn(
              // flex-1 so the title keeps priority; chips shrink/truncate first.
              // Body font (content, not chrome) at 15px — quiet, Linear/Todoist-ward.
              "min-w-0 flex-1 truncate text-left font-sans text-md",
              done ? "text-muted-foreground line-through" : blocked ? "text-muted-foreground" : "text-foreground",
            )}
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (canEdit) onStartEdit();
            }}
          >
            {task.title || "Untitled"}
          </button>
          {progress && progress.total > 0 ? (
            // quiet subtask progress — a mirror, never a wall (principles 4 & 5)
            <span className="shrink-0 font-sans text-xs text-muted-foreground tabular-nums">
              {progress.done}/{progress.total}
            </span>
          ) : null}
          {parentTitle ? (
            <span className="flex min-w-0 shrink items-center gap-1 truncate font-sans text-xs text-muted-foreground">
              <CornerDownRight className="size-3 shrink-0 opacity-70" aria-hidden />
              <span className="truncate">{parentTitle}</span>
            </span>
          ) : null}
          <TagChipList tags={tags} max={3} onTagClick={onTagFilter} className="min-w-0 shrink" />
        </div>
      )}

      {/* meta cluster — quiet, right-aligned */}
      <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        {blocked ? <BlockedMarker taskId={task.id} api={api} /> : null}

        {/* Queue toggle — always visible + quiet (the marker IS the action).
            Committed → accent; idle → faint, darkens on hover/focus. */}
        {canEdit ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={committed ? "Remove from queue" : "Add to queue"}
                aria-pressed={committed}
                onClick={(e) => {
                  e.stopPropagation();
                  api.toggleCommit(task.id);
                }}
                className={cn(
                  "flex size-icon items-center justify-center rounded transition-colors duration-(--motion-fade) ease-(--ease-out)",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  committed ? "text-primary" : "text-muted-foreground/40 hover:text-foreground",
                )}
              >
                <ListChecks className="size-3.5" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent>{committed ? "Remove from queue" : "Add to queue"}</TooltipContent>
          </Tooltip>
        ) : committed ? (
          <span className="flex items-center text-primary" aria-label="Queued">
            <ListChecks className="size-3.5" aria-hidden />
          </span>
        ) : null}

        {task.recurrence ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center" aria-label="Recurring">
                <Repeat className="size-3.5" aria-hidden />
              </span>
            </TooltipTrigger>
            <TooltipContent>{recurrenceLabel(task.recurrence)}</TooltipContent>
          </Tooltip>
        ) : null}

        <LevelDots task={task} />

        <SchedulePopover
          task={task}
          canEdit={canEdit}
          open={command === "schedule"}
          onOpenChange={(o) => !o && onClearCommand()}
          label={scheduled}
          drifted={drifted}
          api={api}
        />

        <DuePopover
          task={task}
          canEdit={canEdit}
          open={command === "due"}
          onOpenChange={(o) => !o && onClearCommand()}
          label={due}
          api={api}
        />

        {showBucket ? (
          <BucketPopover
            task={task}
            buckets={buckets}
            inboxId={inboxId}
            bucketName={bucketName}
            canEdit={canEdit}
            open={command === "bucket"}
            onOpenChange={(o) => !o && onClearCommand()}
            api={api}
          />
        ) : null}
      </div>
    </div>
  );

  if (!canEdit) return row;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={() => onStartEdit()}>Rename</ContextMenuItem>
        <ContextMenuItem onSelect={() => api.toggleDone(task)}>
          {done ? "Mark not done" : "Mark done"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => api.toggleCommit(task.id)}>
          {committed ? "Remove from queue" : "Add to queue"}
        </ContextMenuItem>
        {task.recurrence && !done && task.status !== "archived" ? (
          <ContextMenuItem onSelect={() => api.skipOccurrence(task.id)}>
            Skip occurrence
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onRequestCommand("schedule")}>Schedule…</ContextMenuItem>
        <ContextMenuItem onSelect={() => onRequestCommand("due")}>Set due date…</ContextMenuItem>
        <ContextMenuItem onSelect={() => onRequestCommand("bucket")}>Move to bucket…</ContextMenuItem>
        {task.parentId ? (
          <ContextMenuItem onSelect={() => api.setTaskParent(task.id, null)}>
            Detach from parent
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>Priority</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              value={task.priority ?? "none"}
              onValueChange={(v) =>
                api.patchTask(task.id, { priority: v === "none" ? null : (v as PriorityLevel) })
              }
            >
              <ContextMenuRadioItem value="none">None</ContextMenuRadioItem>
              {LEVEL_OPTIONS.map((l) => (
                <ContextMenuRadioItem key={l.value} value={l.value}>
                  {l.label}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Energy</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              value={task.energyLevel ?? "none"}
              onValueChange={(v) =>
                api.patchTask(task.id, { energyLevel: v === "none" ? null : (v as EnergyLevel) })
              }
            >
              <ContextMenuRadioItem value="none">None</ContextMenuRadioItem>
              {LEVEL_OPTIONS.map((l) => (
                <ContextMenuRadioItem key={l.value} value={l.value}>
                  {l.label}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onSelect={() => api.deleteTask(task.id)}
        >
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ── blocked marker (computed, ambient — dim/quiet, never red; spec §5c) ───────

export function BlockedMarker({ taskId, api }: { taskId: string; api: TasksModuleApi }) {
  const openBlockers = (api.blockersByTask.get(taskId) ?? []).filter(
    (b) => b.status !== "done" && b.status !== "archived",
  );
  const label =
    openBlockers.length === 1
      ? `Blocked by “${openBlockers[0].title || "Untitled"}”`
      : `Blocked by ${openBlockers.length} tasks`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center" aria-label={label}>
          <CircleDashed className="size-3.5" aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// ── inline title editor ───────────────────────────────────────────────────────

function TitleEditor({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <Input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onCommit(value);
        else if (e.key === "Escape") onCancel();
      }}
      onBlur={() => onCommit(value)}
      className="h-7 px-1.5 py-0 font-display text-sm"
    />
  );
}

// ── energy / priority dots (ambient, never alarming) ──────────────────────────

export function LevelDots({ task }: { task: Task }) {
  if (!task.priority && !task.energyLevel) return null;
  return (
    <div className="flex items-center gap-1">
      {task.priority ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="size-2 rounded-full bg-foreground/70"
              aria-label={PRIORITY_LABELS[task.priority]}
            />
          </TooltipTrigger>
          <TooltipContent>{PRIORITY_LABELS[task.priority]}</TooltipContent>
        </Tooltip>
      ) : null}
      {task.energyLevel ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="size-2 rounded-full border border-foreground/60"
              aria-label={ENERGY_LABELS[task.energyLevel]}
            />
          </TooltipTrigger>
          <TooltipContent>{ENERGY_LABELS[task.energyLevel]}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

// ── meta popovers ─────────────────────────────────────────────────────────────

function MetaChip({
  active,
  drifted,
  icon,
  children,
}: {
  active: boolean;
  drifted?: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded px-1 py-0.5 font-sans transition-colors hover:bg-muted",
        active ? "text-foreground" : "text-muted-foreground",
        // drift is ambient — a quiet emphasis, never red / "overdue"
        drifted && "text-foreground",
      )}
    >
      {icon}
      {children}
    </span>
  );
}

function SchedulePopover({
  task,
  canEdit,
  open,
  onOpenChange,
  label,
  drifted,
  api,
}: {
  task: Task;
  canEdit: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string | null;
  drifted: boolean;
  api: TasksModuleApi;
}) {
  if (!canEdit && !label) return null;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild disabled={!canEdit}>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label="Scheduled time"
          // Reserve the slot always; fade in on hover/focus when empty (no
          // layout shift — the old hidden→flex pushed the row's content).
          className={cn(
            "flex items-center transition-opacity duration-(--motion-fade) ease-(--ease-out)",
            label || open ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
          )}
        >
          <MetaChip active={!!label} drifted={drifted} icon={<Clock className="size-3.5" aria-hidden />}>
            {label}
          </MetaChip>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" onClick={(e) => e.stopPropagation()} align="end">
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Scheduled time</label>
        <Input
          type="datetime-local"
          autoFocus
          defaultValue={toLocalInputValue(task.scheduledAt)}
          className="h-8"
          onChange={(e) => {
            const v = e.target.value;
            api.patchTask(task.id, { scheduledAt: v ? new Date(v).toISOString() : null });
          }}
        />
        {task.scheduledAt ? (
          <button
            type="button"
            className="mt-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              api.patchTask(task.id, { scheduledAt: null });
              onOpenChange(false);
            }}
          >
            Clear
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function DuePopover({
  task,
  canEdit,
  open,
  onOpenChange,
  label,
  api,
}: {
  task: Task;
  canEdit: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string | null;
  api: TasksModuleApi;
}) {
  if (!canEdit && !label) return null;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild disabled={!canEdit}>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label="Due date"
          className={cn("items-center", label ? "flex" : open ? "flex" : "hidden group-hover:flex")}
        >
          <MetaChip active={!!label} icon={<CalendarDays className="size-3.5" aria-hidden />}>
            {label}
          </MetaChip>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" onClick={(e) => e.stopPropagation()} align="end">
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Due date</label>
        <Input
          type="date"
          autoFocus
          defaultValue={toDateInputValue(task.dueDate)}
          className="h-8"
          onChange={(e) => {
            const v = e.target.value;
            api.patchTask(task.id, { dueDate: v ? new Date(`${v}T00:00:00`).toISOString() : null });
          }}
        />
        {task.dueDate ? (
          <button
            type="button"
            className="mt-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              api.patchTask(task.id, { dueDate: null });
              onOpenChange(false);
            }}
          >
            Clear
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function BucketPopover({
  task,
  buckets,
  inboxId,
  bucketName,
  canEdit,
  open,
  onOpenChange,
  api,
}: {
  task: Task;
  buckets: Array<{ id: string; name: string; isSystem: boolean }>;
  inboxId: string | null;
  bucketName: string;
  canEdit: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: TasksModuleApi;
}) {
  const options = inboxId
    ? [
        { id: inboxId, name: "Inbox", isSystem: true },
        ...buckets.filter((b) => b.id !== inboxId),
      ]
    : buckets;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild disabled={!canEdit}>
        <button type="button" onClick={(e) => e.stopPropagation()} aria-label="Bucket">
          <Badge variant="secondary" className="gap-1 font-normal">
            {task.bucketId === inboxId ? <Inbox className="size-3" aria-hidden /> : null}
            {bucketName}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" onClick={(e) => e.stopPropagation()} align="end">
        <div className="max-h-64 overflow-auto">
          {options.map((b) => (
            <button
              key={b.id}
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent",
                b.id === task.bucketId && "text-foreground",
              )}
              onClick={() => {
                if (b.id !== task.bucketId) api.patchTask(task.id, { bucketId: b.id });
                onOpenChange(false);
              }}
            >
              {b.isSystem ? <Inbox className="size-3.5 text-muted-foreground" aria-hidden /> : null}
              <span className="truncate">{b.name}</span>
              {b.id === task.bucketId ? <Check className="ml-auto size-3.5" aria-hidden /> : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
