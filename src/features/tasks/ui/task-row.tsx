import type { DraggableSyntheticListeners } from "@dnd-kit/core";
import { Check, ChevronDown, ChevronRight, CornerDownRight, Inbox } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SELECTED_ROW } from "@/components/ui/selection";
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
import { DatePickerPanel, useDateDraft } from "../../../components/ui/date-field";
import { DROP_TARGET } from "../../../components/ui/drag-visuals";
import { Input } from "../../../components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import { assigneeLabel } from "../assignee-options";
import { useAssignees } from "../assignees";
import { LEVEL_OPTIONS, STATUS_LABELS } from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { EnergyLevel, PriorityLevel, Task } from "../model";
import { ALL_ROW_COLUMNS, type RowColumns, type RowDate, rowDate, rowTime } from "../row-layout";
import { AssignContextMenu } from "./assign-context-menu";
import { AssigneeAvatar } from "./assignee-avatar";
import type { DragActivatorRef } from "./dnd/task-dnd";
import { EnergyMark, PriorityMark } from "./level-icons";
import { ROW_TITLE_ATTR } from "./list-keys";
import { QueueToggle } from "./queue-toggle";
import { BucketLabel, DateMark, TaskCounts } from "./task-meta";

// The blocked marker moved to task-meta; the Timeline still imports it here.
export { BlockedMarker } from "./task-meta";

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
  /**
   * The right-hand columns this view shows (computed once per list, so every
   * row's meta lines up). A row rendered on its own shows them all.
   */
  columns?: RowColumns;
  /**
   * Reserve the expand gutter so checkboxes stay aligned. The list turns this
   * on only when the scope actually nests subtasks (quiet until used).
   */
  expandSlot?: boolean;
  /** Subtask nesting (Session 5): this row has children → chevron + n/m mirror. */
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
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
  /** A drag hovers this row and would make the dragged task its subtask
   * (DS-4's DROP_TARGET, the one drop look). */
  dropTarget?: boolean;
  /** False in My tasks, where every row is mine (D4-4). */
  showAssignee?: boolean;
  api: TasksModuleApi;
};

/**
 * One task in the List (tasks-v2 §6): checkbox · title · quiet counts, then
 * fixed right-hand columns (priority · [energy] · date · assignee · queue) so
 * the meta lines up down the list. Display → Rows: Detailed adds the status
 * name, the time and the assignee's name (TV-U2). A done row dims as a whole
 * except its checkbox; selection is the tint (DS-2), never a bar.
 */
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
  columns = ALL_ROW_COLUMNS,
  expandSlot = false,
  expandable = false,
  expanded = false,
  onToggleExpand,
  nested = false,
  parentTitle = null,
  dragListeners,
  dragActivatorRef,
  dropTarget = false,
  showAssignee = true,
  api,
}: Props) {
  const done = task.status === "done";
  // A Won't do task kept in view (TV-P0) reads closed, like a done one.
  const closed = done || task.status === "archived";
  const queued = api.queuedTaskIds.has(task.id);
  // Menu items that hand focus to something in the row (the title editor, a
  // chip's popover) run once the context menu has closed: Radix returns focus
  // to the list a tick after the menu unmounts, and whatever opened sooner
  // reads that as focus leaving it and closes again.
  const pendingMenuAction = useRef<(() => void) | null>(null);
  const afterMenuClose = (action: () => void) => {
    pendingMenuAction.current = action;
  };
  // Blocked — computed, ambient: dim + a quiet icon, never red (spec §5c).
  const blocked = api.blockedTaskIds.has(task.id);
  const { assignees, byId } = useAssignees();
  const assignee = byId(task.assigneeId);
  const assigneeName = assigneeLabel(task.assigneeId, byId);
  // Solo workspaces have nobody to tell apart — the avatar only appears with teammates.
  const withAssignee = columns.assignee && showAssignee && assignees.length > 1;
  const time = columns.time ? rowTime(task) : null;
  const dateCommand = command === "schedule" || command === "due";

  const row = (
    <div
      ref={dragActivatorRef}
      role="row"
      aria-selected={selected}
      data-task-id={task.id}
      data-done={done || undefined}
      onClick={onSelect}
      {...(editing ? {} : dragListeners)}
      className={cn(
        "group relative flex items-center gap-3 rounded-md py-0.5 pr-2.5 pl-2 text-sm",
        "border border-transparent select-none",
        "transition-colors duration-(--motion-fade) ease-(--ease-out)",
        // Whole-row drag (queue reorder / drag-to-nest): a grab cursor signals
        // it; a 6px activation distance keeps plain clicks selecting the row.
        dragListeners ? "cursor-grab active:cursor-grabbing" : "cursor-default",
        selected
          ? // Tint-only selection (R5): the accent tint + the row hairline
            // switch (--state-selected-edge). No bar.
            SELECTED_ROW
          : "hover:bg-state-hover",
        nested && "ml-10",
        // The nest target wins over selection/hover while a drag is live;
        // after the row's own classes so its hover: copy replaces theirs.
        dropTarget && DROP_TARGET,
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
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  done && "opacity-40",
                )}
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

      {/* A done row dims as a whole, except its checkbox (tasks-v2 §6). */}
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
        <div
          data-slot="row-title"
          className={cn("flex min-w-0 flex-1 items-center gap-2.5", closed && "opacity-40")}
        >
          <button
            type="button"
            // Clicking the title selects the row, so its Space/Enter stay the
            // List's (complete / edit), unlike the row's other buttons.
            {...{ [ROW_TITLE_ATTR]: "" }}
            className={cn(
              // The title shrinks first; the counts sit right after it.
              // Body font (content, not chrome) at 15px — quiet, Linear/Todoist-ward.
              "min-w-0 truncate text-left font-sans text-md",
              // Done dims through the cell's opacity, like the comp; a muted
              // colour on top would dim it twice.
              closed
                ? "text-foreground line-through"
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
          <TaskCounts task={task} api={api} />
          {parentTitle ? (
            <span className="flex min-w-0 shrink-3 items-center gap-1 truncate font-sans text-xs text-muted-foreground">
              <CornerDownRight className="size-icon-xs shrink-0 opacity-70" aria-hidden />
              <span className="truncate">{parentTitle}</span>
            </span>
          ) : null}
          {showBucket || canEdit ? (
            <BucketPopover
              task={task}
              buckets={buckets}
              inboxId={inboxId}
              bucketName={bucketName}
              showLabel={showBucket}
              canEdit={canEdit}
              open={command === "bucket"}
              onOpenChange={(o) => (o ? onRequestCommand("bucket") : onClearCommand())}
              api={api}
            />
          ) : null}
        </div>
      )}

      {/* Fixed columns: each cell has a set width, so a column lines up down
          the list, and an empty cell still holds its place. */}
      <div
        data-slot="row-columns"
        className={cn("flex shrink-0 items-center gap-3", closed && "opacity-40")}
      >
        {/* Detailed's cells hold their width (min-w, so a longer value widens
            the cell rather than truncate, call 41). */}
        {columns.status ? (
          <span
            data-col="status"
            className="min-w-24 shrink-0 whitespace-nowrap font-sans text-xs text-muted-foreground"
          >
            {STATUS_LABELS[task.status]}
          </span>
        ) : null}
        {columns.priority ? (
          <span data-col="priority" className="flex w-icon-sm shrink-0 items-center justify-center">
            <PriorityMark level={task.priority} />
          </span>
        ) : null}
        {columns.energy ? (
          <span data-col="energy" className="flex w-icon-sm shrink-0 items-center justify-center">
            <EnergyMark level={task.energyLevel} />
          </span>
        ) : null}
        {columns.date || dateCommand ? (
          <DateCell
            task={task}
            canEdit={canEdit}
            command={dateCommand ? command : null}
            onRequestCommand={onRequestCommand}
            onClearCommand={onClearCommand}
            api={api}
          />
        ) : null}
        {columns.time ? (
          <span
            data-col="time"
            className="min-w-22 shrink-0 whitespace-nowrap text-right font-sans text-xs tabular-nums text-muted-foreground"
          >
            {time}
          </span>
        ) : null}
        {withAssignee && columns.assigneeName ? (
          <span
            data-col="assignee"
            className="flex min-w-24 shrink-0 items-center gap-1.5 whitespace-nowrap font-sans text-xs text-muted-foreground"
          >
            {task.assigneeId ? (
              <>
                <AssigneeAvatar assignee={assignee} size="icon" />
                {assignee ? firstName(assignee.name) : assigneeName}
              </>
            ) : null}
          </span>
        ) : withAssignee ? (
          <span data-col="assignee" className="flex w-icon shrink-0 items-center justify-center">
            {task.assigneeId ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="flex items-center"
                    role="img"
                    aria-label={`Assignee: ${assigneeName}`}
                  >
                    <AssigneeAvatar assignee={assignee} size="icon" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>{assigneeName}</TooltipContent>
              </Tooltip>
            ) : null}
          </span>
        ) : null}
        {/* Queue mark — pinned to the far right so it has one predictable,
            targetable home (the marker IS the action): my queue toggle, or a
            teammate's ringed avatar when it's in their queue (TV-D4). The
            toggle shows on hover, focus or selection unless the task is
            queued or claimed (QueueToggle's revealOnHover, the comp). */}
        {columns.queue ? (
          <span
            data-col="queue"
            className={cn(
              "flex shrink-0 items-center justify-end gap-1",
              columns.queueWide ? "w-[calc(var(--icon)*2_+_0.25rem)]" : "w-icon",
            )}
          >
            <QueueToggle task={task} api={api} canEdit={canEdit} revealOnHover />
          </span>
        ) : null}
      </div>
    </div>
  );

  if (!canEdit) return row;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent
        className="w-48"
        onCloseAutoFocus={(e) => {
          const action = pendingMenuAction.current;
          if (!action) return;
          pendingMenuAction.current = null;
          e.preventDefault(); // the editor or popover takes focus, not the list
          action();
        }}
      >
        <ContextMenuItem onSelect={() => afterMenuClose(onStartEdit)}>Rename</ContextMenuItem>
        <ContextMenuItem onSelect={() => api.toggleDone(task)}>
          {done ? "Mark not done" : "Mark done"}
        </ContextMenuItem>
        {!done && task.status !== "archived" ? (
          <ContextMenuItem onSelect={() => api.toggleQueue(task.id)}>
            {queued ? "Remove from queue" : "Add to queue"}
          </ContextMenuItem>
        ) : null}
        {task.recurrence && !done && task.status !== "archived" ? (
          <ContextMenuItem onSelect={() => api.skipOccurrence(task.id)}>
            Skip occurrence
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => afterMenuClose(() => onRequestCommand("schedule"))}>
          Schedule…
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => afterMenuClose(() => onRequestCommand("due"))}>
          Set due date…
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => afterMenuClose(() => onRequestCommand("bucket"))}>
          Move to bucket…
        </ContextMenuItem>
        {task.parentId ? (
          <ContextMenuItem onSelect={() => api.setTaskParent(task.id, null)}>
            Detach from parent
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <AssignContextMenu task={task} api={api} />
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
  // Enter and Esc end the edit by handing focus back to the list, and the blur
  // that causes must not commit again (or save a draft Esc threw away).
  const ended = useRef(false);
  const end = (commit: boolean) => {
    if (ended.current) return;
    ended.current = true;
    if (commit) onCommit(value);
    else onCancel();
  };
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
        if (e.key === "Enter") end(true);
        else if (e.key === "Escape") end(false);
      }}
      onBlur={() => end(true)}
      className="h-7 px-1.5 py-0 font-display text-sm"
    />
  );
}

// LevelDots (priority/energy glyphs) now lives in ./level-icons.

// ── meta popovers ─────────────────────────────────────────────────────────────

// Closing a row popover hands focus back to the list (onClearCommand). Without
// this, Radix moves it to the chip once the popover unmounts after a click on
// the chip itself.
const keepListFocus = (e: Event) => e.preventDefault();

/**
 * The date column: the one date the row shows (row-layout's `rowDate`), and
 * the way to edit it. A click opens the editor for the date shown; `s` / `d`
 * and the menu open the scheduled or due editor whichever is shown. An empty
 * cell holds its place but offers nothing to click (set a date with the menu,
 * the keys or the panel), so a stray click on the row never opens an editor.
 */
function DateCell({
  task,
  canEdit,
  command,
  onRequestCommand,
  onClearCommand,
  api,
}: {
  task: Task;
  canEdit: boolean;
  command: "schedule" | "due" | null;
  onRequestCommand: (command: RowCommand) => void;
  onClearCommand: () => void;
  api: TasksModuleApi;
}) {
  const date = rowDate(task);
  // At least the column's width; a wider date (another year's) widens it
  // rather than truncate (call 41).
  const cell = "flex min-w-19 shrink-0 items-center justify-end";
  const kind = command ?? (date?.kind === "due" ? "due" : "schedule");
  // One save when the popover closes (TV-P0): a scheduled time goes through
  // the reschedule op, so it lands in the task's trail.
  const current = kind === "schedule" ? task.scheduledAt : task.dueDate;
  const draft = useDateDraft({
    value: current ? new Date(current) : null,
    onChange: (d) =>
      api.patchTask(
        task.id,
        kind === "schedule"
          ? { scheduledAt: d ? d.toISOString() : null }
          : { dueDate: d ? d.toISOString() : null },
      ),
    withTime: kind === "schedule",
    open: command !== null,
    done: onClearCommand,
  });
  if (!date && !command) return <span data-col="date" className={cell} aria-hidden />;
  // With a date, its description names it ("Scheduled …", "Due …").
  const label = date ? date.description : kind === "due" ? "Due date" : "Scheduled time";

  if (!canEdit) {
    return (
      <span data-col="date" className={cell}>
        {date ? (
          <DateTip date={date}>
            <span role="img" aria-label={label} className="flex min-w-0 items-center">
              <DateMark date={date} />
            </span>
          </DateTip>
        ) : null}
      </span>
    );
  }

  const trigger = (
    <PopoverTrigger asChild>
      <button
        type="button"
        data-col="date"
        onClick={(e) => e.stopPropagation()}
        aria-label={label}
        className={cn(
          cell,
          "rounded-sm px-1 transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        )}
      >
        {date ? <DateMark date={date} /> : null}
      </button>
    </PopoverTrigger>
  );

  return (
    <Popover
      open={command !== null}
      onOpenChange={(o) => (o ? onRequestCommand(kind) : draft.close())}
    >
      {date ? <DateTip date={date}>{trigger}</DateTip> : trigger}
      <PopoverContent
        className="w-auto p-0"
        onClick={(e) => e.stopPropagation()}
        onCloseAutoFocus={keepListFocus}
        onEscapeKeyDown={draft.cancel}
        align="end"
      >
        <p className="px-3 pt-2.5 font-sans text-xs font-medium text-muted-foreground">
          {kind === "schedule" ? "Scheduled time" : "Due date"}
        </p>
        <DatePickerPanel draft={draft} />
      </PopoverContent>
    </Popover>
  );
}

/** The full dates behind the short label. */
function DateTip({ date, children }: { date: RowDate; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{date.description}</TooltipContent>
    </Tooltip>
  );
}

function BucketPopover({
  task,
  buckets,
  inboxId,
  bucketName,
  showLabel,
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
   * `b` key can still open it; the label then shows as its anchor. */
  showLabel: boolean;
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
          aria-label={`Bucket: ${bucketName}`}
          className={cn(
            "min-w-0 shrink-3 rounded-sm px-1 transition-colors duration-(--motion-fade) ease-(--ease-out)",
            canEdit && "hover:bg-state-hover",
            showLabel || open ? "flex" : "hidden",
          )}
        >
          <BucketLabel name={bucketName} isInbox={task.bucketId === inboxId} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-48 p-1"
        onClick={(e) => e.stopPropagation()}
        onCloseAutoFocus={keepListFocus}
        align="end"
      >
        <div className="max-h-64 overflow-auto">
          {options.map((b) => (
            <button
              key={b.id}
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-state-hover",
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

/** Detailed's assignee cell: the first name ("Mike" of "Mike Grochowski"; "Me" stays). */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
