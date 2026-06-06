import { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, Clock, Inbox, Repeat, Sunrise } from "lucide-react";

import { Badge } from "../../../components/ui/badge";
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
  PRIORITY_LABELS,
  toDateInputValue,
  toLocalInputValue,
} from "../helpers";
import { isDrifted, type EnergyLevel, type PriorityLevel, type Task } from "../model";
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
  api: TasksModuleApi;
};

const LEVELS: Array<{ value: EnergyLevel | PriorityLevel; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

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
  api,
}: Props) {
  const done = task.status === "done";
  const drifted = isDrifted(task);
  const committed = !!task.committedFor && task.committedFor === api.today;
  const scheduled = formatScheduled(task.scheduledAt);
  const due = formatDue(task.dueDate);

  const row = (
    <div
      role="row"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
        "border border-transparent cursor-default select-none",
        selected ? "bg-accent" : "hover:bg-accent/60",
      )}
    >
      <CompleteToggle done={done} disabled={!canEdit} onToggle={() => api.toggleDone(task)} />

      <div className="min-w-0 flex-1">
        {editing ? (
          <TitleEditor
            initial={task.title}
            onCommit={(value) => {
              const next = value.trim();
              if (next && next !== task.title) api.patchTask(task.id, { title: next });
              onEndEdit();
            }}
            onCancel={onEndEdit}
          />
        ) : (
          <button
            type="button"
            className={cn(
              "block max-w-full truncate text-left font-display",
              done ? "text-muted-foreground line-through" : "text-foreground",
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
        )}
      </div>

      {/* meta cluster — quiet, right-aligned */}
      <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        {committed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center text-foreground" aria-label="Committed for today">
                <Sunrise className="size-3.5" aria-hidden />
              </span>
            </TooltipTrigger>
            <TooltipContent>Committed for today</TooltipContent>
          </Tooltip>
        ) : null}

        {task.recurrence ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center" aria-label="Recurring">
                <Repeat className="size-3.5" aria-hidden />
              </span>
            </TooltipTrigger>
            <TooltipContent>{task.recurrence.rrule}</TooltipContent>
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
          {committed ? "Remove from today" : "Commit to today"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onRequestCommand("schedule")}>Schedule…</ContextMenuItem>
        <ContextMenuItem onSelect={() => onRequestCommand("due")}>Set due date…</ContextMenuItem>
        <ContextMenuItem onSelect={() => onRequestCommand("bucket")}>Move to bucket…</ContextMenuItem>
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
              {LEVELS.map((l) => (
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
              {LEVELS.map((l) => (
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

// ── complete toggle (bespoke; checkbox is not an enumerated shadcn primitive) ──

function CompleteToggle({
  done,
  disabled,
  onToggle,
}: {
  done: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={done}
      aria-label={done ? "Mark as not done" : "Mark as done"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        done
          ? "border-primary bg-primary text-primary-foreground"
          : "border-muted-foreground/50 hover:border-foreground",
        disabled && "opacity-50",
      )}
    >
      {done ? <Check className="size-2.5" strokeWidth={3} aria-hidden /> : null}
    </button>
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

function LevelDots({ task }: { task: Task }) {
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
          // empty + idle collapses (no reserved space); reveals on hover or when opened
          className={cn("items-center", label ? "flex" : open ? "flex" : "hidden group-hover:flex")}
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
