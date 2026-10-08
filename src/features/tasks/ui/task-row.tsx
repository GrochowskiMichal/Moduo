import type { DraggableSyntheticListeners } from "@dnd-kit/core";
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
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SELECTED_ROW } from "@/components/ui/selection";
import { TagChipList } from "../../../components/tag-chip";
import { Badge } from "../../../components/ui/badge";
import { CompleteToggle } from "../../../components/ui/complete-toggle";
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
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import { previewAssign, useAssignees } from "../assignees";
import {
  formatDue,
  formatScheduled,
  LEVEL_OPTIONS,
  toDateInputValue,
  toLocalInputValue,
} from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import { type EnergyLevel, isDrifted, type PriorityLevel, type Task } from "../model";
import { recurrenceLabel } from "../parse/recurrence";
import { AssigneeAvatar } from "./assignee-avatar";
import type { DragActivatorRef } from "./dnd/task-dnd";
import { LevelDots } from "./level-icons";
import { ROW_TITLE_ATTR } from "./list-keys";

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
  /** When set, the whole row is the drag activator (no separate grip): the
   * dnd-kit listeners from the sortable/draggable wrapper, spread on the row
   * root. Absent → the row isn't draggable (looks/behaves as before). */
  dragListeners?: DraggableSyntheticListeners;
  /** Goes with `dragListeners`: makes the row root the only keyboard drag
   * activator, so Space/Enter on a button inside the row stay that button's. */
  dragActivatorRef?: DragActivatorRef;
  /** Highlight as the live drop target during a drag-to-nest (quiet accent +
   * ring, mirrors the board column's drag-over treatment). */
  dropActive?: boolean;
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
  dragListeners,
  dragActivatorRef,
  dropActive = false,
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
  const { assignees, byId } = useAssignees();
  const assignee = byId(task.ownerId);

  const row = (
    <div
      ref={dragActivatorRef}
      role="row"
      aria-selected={selected}
      data-task-id={task.id}
      onClick={onSelect}
      {...(editing ? {} : dragListeners)}
      className={cn(
        "group relative flex items-center gap-2 rounded-md px-2 py-0.5 text-sm",
        "border border-transparent select-none",
        // Whole-row drag (queue reorder / drag-to-nest): a grab cursor signals
        // it; a 6px activation distance keeps plain clicks selecting the row.
        dragListeners ? "cursor-grab active:cursor-grabbing" : "cursor-default",
        // Drop-target highlight wins over selection/hover while a nest drag is
        // live (mirrors the board column's drag-over treatment — ring + accent).
        dropActive
          ? "bg-accent/50 ring-1 ring-inset ring-ring/50"
          : selected
            ? // Tint-only selection (R5): the accent tint + the row hairline
              // switch (--state-selected-edge). No bar.
              SELECTED_ROW
            : "hover:bg-state-hover",
        nested && "ml-10",
      )}
      // height rides the density setting; py is only a multiline guard
      style={{ minHeight: "var(--row-h)" }}
    >
      {/* nested subtask indent guide — a quiet vertical hairline in the indent gutter */}
      {nested ? (
        <span className="absolute inset-y-0 -left-4 w-px bg-border/60" aria-hidden />
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
            // Clicking the title selects the row, so its Space/Enter stay the
            // List's (complete / edit), unlike the row's other buttons.
            {...{ [ROW_TITLE_ATTR]: "" }}
            className={cn(
              // flex-1 so the title keeps priority; chips shrink/truncate first.
              // Body font (content, not chrome) at 15px — quiet, Linear/Todoist-ward.
              "min-w-0 flex-1 truncate text-left font-sans text-md",
              done
                ? "text-muted-foreground line-through"
                : blocked
                  ? "text-muted-foreground"
                  : "text-foreground",
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

        {/* Solo workspaces have nobody to tell apart — the avatar only appears with teammates. */}
        {assignees.length > 1 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="flex items-center"
                aria-label={`Assignee: ${assignee?.name ?? "none"}`}
              >
                <AssigneeAvatar assignee={assignee} className="size-4" />
              </span>
            </TooltipTrigger>
            <TooltipContent>{assignee?.name ?? "Unassigned"}</TooltipContent>
          </Tooltip>
        ) : null}

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

        {showBucket || canEdit ? (
          <BucketPopover
            task={task}
            buckets={buckets}
            inboxId={inboxId}
            bucketName={bucketName}
            showPill={showBucket}
            canEdit={canEdit}
            open={command === "bucket"}
            onOpenChange={(o) => !o && onClearCommand()}
            api={api}
          />
        ) : null}

        {/* Queue toggle — pinned to the far right so it has one predictable,
            targetable home (the marker IS the action). Committed → accent; idle →
            faint, darkens on hover/focus. */}
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
        <ContextMenuItem onSelect={() => onRequestCommand("bucket")}>
          Move to bucket…
        </ContextMenuItem>
        {task.parentId ? (
          <ContextMenuItem onSelect={() => api.setTaskParent(task.id, null)}>
            Detach from parent
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        {assignees.length > 1 ? (
          <ContextMenuSub>
            <ContextMenuSubTrigger>Assign to</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuRadioGroup
                value={task.ownerId}
                onValueChange={(v) => {
                  if (v === task.ownerId) return;
                  const person = assignees.find((a) => a.userId === v);
                  if (!person?.canTakeTasks) return;
                  void previewAssign(task.bucketId, v).then((msg) => {
                    if (msg) toast.message(msg);
                  });
                  api.patchTask(task.id, { ownerId: v });
                }}
              >
                {assignees.map((a) => (
                  <ContextMenuRadioItem key={a.userId} value={a.userId} disabled={!a.canTakeTasks}>
                    {a.canTakeTasks ? a.name : `${a.name} (view only)`}
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
        ) : null}
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
        <ContextMenuItem variant="destructive" onSelect={() => api.deleteTask(task.id)}>
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

// LevelDots (priority/energy glyphs) now lives in ./level-icons.

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
          // Show only when a time is set (or the keyboard opened the popover).
          // No empty hover-reveal — it flickered and shifted the row for no gain;
          // set/clear instead via right-click, the `s` key, or the detail panel.
          className={cn("items-center", label || open ? "flex" : "hidden")}
        >
          <MetaChip
            active={!!label}
            drifted={drifted}
            icon={<Clock className="size-3.5" aria-hidden />}
          >
            {label}
          </MetaChip>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" onClick={(e) => e.stopPropagation()} align="end">
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Scheduled time
        </label>
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
          // Show only when a due date is set (or the keyboard opened the popover)
          // — no empty hover-reveal. Set/clear via right-click, `d`, or the panel.
          className={cn("items-center", label || open ? "flex" : "hidden")}
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
  showPill,
  canEdit,
  open,
  onOpenChange,
  api,
}: {
  task: Task;
  buckets: Array<{ id: string; name: string; isSystem: boolean }>;
  inboxId: string | null;
  bucketName: string;
  /** False where the bucket is implied (Q1-3). The popover stays mounted so the
   * `b` key can still open it; the pill then shows as its anchor. */
  showPill: boolean;
  canEdit: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: TasksModuleApi;
}) {
  const options = inboxId
    ? [{ id: inboxId, name: "Inbox", isSystem: true }, ...buckets.filter((b) => b.id !== inboxId)]
    : buckets;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild disabled={!canEdit}>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label="Bucket"
          className={showPill || open ? undefined : "hidden"}
        >
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
