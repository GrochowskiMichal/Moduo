import { isClosedTask, taskCategoryOf } from "@contracts/vocabularies";
import type { DraggableSyntheticListeners } from "@dnd-kit/core";
import { ChevronDown, ChevronRight, CornerDownRight } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
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
import { Row, RowColumn, RowColumns as RowColumnsSlot } from "../../../components/ui/row";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import { assigneeLabel } from "../assignee-options";
import { useAssignees } from "../assignees";
import { requestBreakDown } from "../break-down";
import { LEVEL_OPTIONS } from "../helpers";
import { type EnergyLevel, isLate, type PriorityLevel, type Task } from "../model";
import {
  ALL_ROW_COLUMNS,
  handleLabel,
  type RowColumns,
  rowTime,
  updatedLabel,
} from "../row-layout";
import { nowOn } from "../use-today";
import { AssignContextMenu } from "./assign-context-menu";
import { AssigneeAvatar } from "./assignee-avatar";
import type { DragActivatorRef } from "./dnd/task-dnd";
import { EnergyMark, PriorityMark } from "./level-icons";
import { ROW_TITLE_ATTR } from "./list-keys";
import { QueueToggle } from "./queue-toggle";
import { sameTaskFacts, sameValues, type TaskFacts, type TaskRowActions } from "./row-facts";
import { TaskCounts } from "./task-meta";
import {
  DateCell,
  glyphAction,
  HandleCell,
  LateFixes,
  ProjectMenu,
  StatusGlyph,
} from "./task-row-cells";

// The blocked marker moved to task-meta; the Timeline still imports it here.
export { BlockedMarker } from "./task-meta";

/** Which inline menu or popover the keyboard asked to open on this row. */
export type RowCommand = "bucket" | "schedule" | "due" | "status" | null;

type Props = {
  task: Task;
  bucketName: string;
  inboxId: string | null;
  /** Standard: the project shows after the counts (where the scope doesn't
   *  imply it). Detailed has its own column (`columns.project`). */
  showBucket: boolean;
  selected: boolean;
  editing: boolean;
  command: RowCommand;
  canEdit: boolean;
  /**
   * What the row shows beyond its task (queue, claims, blocked, tags,
   * subtasks, status name, section, waiting, comments, pending): its own facts
   * only, so it redraws when they change and not when another task does
   * (row-facts.ts, TV-D11b).
   */
  facts: TaskFacts;
  /** The row's actions: one object for the life of the view (`useRowActions`). */
  actions: TaskRowActions;
  /**
   * Today's date key (`useToday`): the date cells say "Today", "Tomorrow" or
   * late against it, so a row left open over midnight redraws then.
   */
  today: string;
  /** Goes up each minute while the row shows its age (Updated), so it redraws. */
  ageTick?: number;
  /** Callbacks take the task's id, so one function serves every row. */
  onSelect: (taskId: string) => void;
  onStartEdit: (taskId: string) => void;
  onEndEdit: () => void;
  onClearCommand: () => void;
  onRequestCommand: (taskId: string, command: RowCommand) => void;
  /**
   * The columns this view shows (computed once per list, so every row's meta
   * lines up; their widths are the list's `--tl-col-*` variables). A row
   * rendered on its own shows Standard's.
   */
  columns?: RowColumns;
  /** The workspace's task key ("MOD"): Detailed's handle. */
  taskKey?: string | null;
  /**
   * Reserve the expand gutter so status icons stay aligned. The list turns
   * this on only when the scope actually nests subtasks (quiet until used).
   */
  expandSlot?: boolean;
  /** Subtask nesting (Session 5): this row has children → chevron + n/m mirror. */
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: (taskId: string) => void;
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
  /**
   * "Take it" on a team's unclaimed task (My tasks' team block, TV-U15): the
   * row shows the button while its facts say `takeable`.
   */
  onTake?: (taskId: string) => void;
};

/**
 * One task in the List (tasks-v3 §4, TV-U10) on the kit Row: status icon ·
 * [handle] · title · quiet counts · [project], then the columns (Standard:
 * priority · date · avatar · Focus mark; Detailed adds Project › Section, the
 * status name, Due and Next session, time, waiting, the assignee's name and
 * updated). The title takes the free width and gives way first; columns hold
 * the list's widths, so nothing in them truncates. Hover shows only the Focus
 * mark, an empty date cell's picker and a late row's fixes (default i). A
 * closed row fades as a whole except its status icon; selection is the tint
 * (DS-2), never a bar.
 */
export const TaskRow = memo(TaskRowView, sameRowProps);

/** Two rows' props that draw the same row: facts and columns by value. */
function sameRowProps(a: Props, b: Props): boolean {
  for (const key of Object.keys(a) as (keyof Props)[]) {
    if (key === "facts" || key === "columns") continue;
    if (!Object.is(a[key], b[key])) return false;
  }
  if (Object.keys(a).length !== Object.keys(b).length) return false;
  if (!sameTaskFacts(a.facts, b.facts)) return false;
  return (
    a.columns === b.columns || (!!a.columns && !!b.columns && sameValues(a.columns, b.columns))
  );
}

/** Finish an open task, or reopen a closed one (To do): the glyph, Space, `x`. */
export function activateGlyph(task: Task, actions: TaskRowActions): void {
  if (glyphAction(task) === "finish") {
    actions.toggleDone(task);
    return;
  }
  // Done goes back the way it always has; Won't do reopens to To do too.
  if (taskCategoryOf(task) === "done") actions.toggleDone(task);
  else actions.setTaskStatus(task.id, { category: "todo" });
}

function TaskRowView({
  task,
  bucketName,
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
  taskKey = null,
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
  onTake,
  facts,
  actions,
  today,
}: Props) {
  const done = taskCategoryOf(task) === "done";
  // A Won't do task kept in view (TV-P0) reads closed, like a done one.
  const closed = isClosedTask(task);
  const queued = facts.queued;
  const late = isLate(task, today);
  // Menu items that hand focus to something in the row (the title editor, a
  // chip's popover) run once the context menu has closed: Radix returns focus
  // to the list a tick after the menu unmounts, and whatever opened sooner
  // reads that as focus leaving it and closes again.
  const pendingMenuAction = useRef<(() => void) | null>(null);
  const afterMenuClose = (action: () => void) => {
    pendingMenuAction.current = action;
  };
  // Blocked — computed, ambient: dim + a quiet icon, never red (spec §5c).
  const blocked = facts.blockedLabel !== null;
  const { assignees, byId } = useAssignees();
  const assignee = byId(task.assigneeId);
  const assigneeName = assigneeLabel(task.assigneeId, byId);
  // Solo workspaces have nobody to tell apart — the avatar only appears with teammates.
  const withAssignee = columns.assignee && showAssignee && assignees.length > 1;
  const detailed = columns.project || columns.status || columns.updated;
  const dateCommand = command === "schedule" || command === "due" ? command : null;
  const handle = handleLabel(taskKey, task.number);
  const now = nowOn(today);
  const projectVariant = columns.project ? null : showBucket ? "inline" : "implied";
  const projectMenu = (variant: "inline" | "column" | "implied") => (
    <ProjectMenu
      task={task}
      inboxId={inboxId}
      projectName={bucketName}
      sectionName={facts.sectionName}
      variant={variant}
      canEdit={canEdit}
      open={command === "bucket"}
      onOpenChange={(o) => (o ? onRequestCommand(task.id, "bucket") : onClearCommand())}
      actions={actions}
    />
  );
  const fixes =
    late && canEdit ? (
      <LateFixes
        onMove={() => onRequestCommand(task.id, "due")}
        onWontDo={() => actions.setTaskStatus(task.id, { category: "wont_do" })}
        onBreakDown={
          task.parentId
            ? null
            : () => {
                onSelect(task.id);
                requestBreakDown(task.id);
              }
        }
      />
    ) : null;

  const row = (
    <Row
      ref={dragActivatorRef}
      role="row"
      aria-selected={selected}
      data-task-id={task.id}
      data-late={late || undefined}
      selected={selected}
      done={closed}
      dropTarget={dropTarget}
      onClick={() => onSelect(task.id)}
      {...(editing ? {} : dragListeners)}
      className={cn(
        // `group` too: the Focus mark and older cells read the unnamed group.
        "group text-sm select-none",
        // Whole-row drag (queue reorder / drag-to-nest): a grab cursor signals
        // it; a 6px activation distance keeps plain clicks selecting the row.
        dragListeners ? "cursor-grab active:cursor-grabbing" : "cursor-default",
        nested && "ml-10",
      )}
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
                  // hit-min pads the pointer target to 24 px; the glyph stays put.
                  "hit-min flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  closed && "opacity-40",
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpand?.(task.id);
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
      <StatusGlyph
        task={task}
        statusName={facts.statusName}
        canEdit={canEdit}
        menuOpen={command === "status"}
        onMenuOpenChange={(o) => (o ? onRequestCommand(task.id, "status") : onClearCommand())}
        onActivate={() => activateGlyph(task, actions)}
        onPickStatus={(target) => actions.setTaskStatus(task.id, target)}
      />
      {columns.handle ? <HandleCell handle={handle} /> : null}

      {editing ? (
        <div className="min-w-0 flex-1">
          <TitleEditor
            initial={task.title}
            onCommit={(value) => {
              const next = value.trim();
              if (next && next !== task.title) actions.patchTask(task.id, { title: next });
              onEndEdit();
            }}
            onCancel={onEndEdit}
          />
        </div>
      ) : (
        <div
          data-slot="row-title"
          // The title is the one flexible track: it takes the free width (the
          // checkpoint-1 fix) and gives way first (call 42).
          className="relative flex min-w-0 flex-1 items-center gap-2.5 group-data-[done]/row:opacity-50"
        >
          <button
            type="button"
            // Clicking the title selects the row, so its Space/Enter stay the
            // List's (complete / edit), unlike the row's other buttons.
            {...{ [ROW_TITLE_ATTR]: "" }}
            className={cn(
              // Body font (content, not chrome) at 15px — quiet, Linear/Todoist-ward.
              "min-w-0 truncate text-left font-sans text-md",
              // A closed row dims through the cell's opacity; a muted colour on
              // top would dim it twice.
              closed
                ? "text-foreground line-through decoration-subtle-foreground"
                : blocked
                  ? "text-muted-foreground"
                  : "text-foreground",
            )}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(task.id);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (canEdit) onStartEdit(task.id);
            }}
          >
            {task.title || "Untitled"}
          </button>
          <TaskCounts
            task={task}
            facts={facts}
            tagNames={detailed}
            waitingColumn={columns.waiting}
          />
          {facts.source ? (
            // Where an Inbox task came from (research §7): quiet, after the counts.
            <span
              data-slot="row-source"
              className="shrink-0 font-sans text-xs whitespace-nowrap text-muted-foreground"
            >
              {facts.source}
            </span>
          ) : null}
          {parentTitle ? (
            <span className="flex min-w-0 shrink-3 items-center gap-1 truncate font-sans text-xs text-muted-foreground">
              <CornerDownRight className="size-icon-xs shrink-0 opacity-70" aria-hidden />
              <span className="truncate">{parentTitle}</span>
            </span>
          ) : null}
          {projectVariant && (showBucket || canEdit) ? projectMenu(projectVariant) : null}
          {facts.takeable && onTake && canEdit ? (
            // The team block's one action (TV-U15): always shown, so the
            // block says what to do with it.
            <Button
              variant="outline"
              size="sm"
              data-slot="row-take"
              onClick={(e) => {
                e.stopPropagation();
                onTake(task.id);
              }}
              className="shrink-0"
            >
              Take it
            </Button>
          ) : null}
          {/* A late row's fixes, over the cell's end on hover or selection:
              they fade in and take no room from the title (R6: nothing
              reflows), on the row's own surface so the title doesn't show
              through. */}
          {fixes ? (
            <span
              className={cn(
                "absolute inset-y-0 end-0 flex items-center bg-card",
                "invisible opacity-0 transition-[opacity,visibility] duration-(--motion-fade) ease-(--ease-out)",
                "group-hover/row:visible group-hover/row:opacity-100",
                "group-data-[selected]/row:visible group-data-[selected]/row:opacity-100",
              )}
            >
              <span className="flex h-full items-center ps-2 group-hover/row:bg-state-hover group-data-[selected]/row:bg-state-selected">
                {fixes}
              </span>
            </span>
          ) : null}
        </div>
      )}

      {/* The columns: each holds the list's width for it, so a column lines up
          down the list, and an empty cell still holds its place. */}
      <RowColumnsSlot data-slot="row-columns">
        {columns.project ? projectMenu("column") : null}
        {columns.status ? (
          <RowColumn data-col="status" className="justify-start min-w-(--tl-col-status)">
            {/* The project's own name; the icon (the lead) is the category's. */}
            {canEdit ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRequestCommand(task.id, "status");
                }}
                className="-mx-1 rounded-sm px-1 text-left transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {facts.statusName}
              </button>
            ) : (
              facts.statusName
            )}
          </RowColumn>
        ) : null}
        {columns.priority ? (
          <RowColumn data-col="priority" className="w-icon-sm justify-center">
            <PriorityMark level={task.priority} />
          </RowColumn>
        ) : null}
        {columns.energy ? (
          <RowColumn data-col="energy" className="w-icon-sm justify-center">
            <EnergyMark level={task.energyLevel} />
          </RowColumn>
        ) : null}
        {columns.date || (!detailed && dateCommand) ? (
          <DateCell
            task={task}
            kind="row"
            label={facts.when ?? null}
            canEdit={canEdit}
            command={dateCommand}
            today={today}
            onRequestCommand={(kind) => onRequestCommand(task.id, kind)}
            onClearCommand={onClearCommand}
            actions={actions}
          />
        ) : null}
        {columns.due || (detailed && dateCommand === "due") ? (
          <DateCell
            task={task}
            kind="due"
            canEdit={canEdit}
            command={dateCommand === "due" ? "due" : null}
            today={today}
            onRequestCommand={(kind) => onRequestCommand(task.id, kind)}
            onClearCommand={onClearCommand}
            actions={actions}
          />
        ) : null}
        {columns.session || (detailed && dateCommand === "schedule") ? (
          <DateCell
            task={task}
            kind="session"
            canEdit={canEdit}
            command={dateCommand === "schedule" ? "schedule" : null}
            today={today}
            onRequestCommand={(kind) => onRequestCommand(task.id, kind)}
            onClearCommand={onClearCommand}
            actions={actions}
          />
        ) : null}
        {columns.time ? (
          <RowColumn data-col="time" className="min-w-(--tl-col-time)">
            {rowTime(task)}
          </RowColumn>
        ) : null}
        {columns.waiting ? (
          <RowColumn
            data-col="waiting"
            className="justify-start whitespace-normal min-w-(--tl-col-waiting) max-w-(--tl-col-waiting)"
          >
            {facts.waiting}
          </RowColumn>
        ) : null}
        {withAssignee && columns.assigneeName ? (
          <RowColumn
            data-col="assignee"
            className="justify-start gap-1.5 min-w-(--tl-col-assignee)"
          >
            {task.assigneeId ? (
              <>
                <AssigneeAvatar assignee={assignee} assigneeId={task.assigneeId} size="icon" />
                {assignee ? firstName(assignee.name) : assigneeName}
              </>
            ) : null}
          </RowColumn>
        ) : withAssignee ? (
          <RowColumn data-col="assignee" width="icon">
            {task.assigneeId ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="flex items-center"
                    role="img"
                    aria-label={`Assignee: ${assigneeName}`}
                  >
                    <AssigneeAvatar assignee={assignee} assigneeId={task.assigneeId} size="icon" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>{assigneeName}</TooltipContent>
              </Tooltip>
            ) : null}
          </RowColumn>
        ) : null}
        {columns.updated ? (
          <RowColumn data-col="updated" className="min-w-(--tl-col-updated)">
            {updatedLabel(task, now)}
          </RowColumn>
        ) : null}
        {/* The Focus mark — pinned to the far right so it has one predictable,
            targetable home (the marker IS the action): my queue toggle, or a
            teammate's ringed avatar when it's in their queue (TV-D4). It shows
            on hover, focus or selection unless the task is queued or claimed. */}
        {columns.queue ? (
          <RowColumn
            data-col="queue"
            className={cn(
              "gap-1",
              columns.queueWide ? "w-[calc(var(--icon)*2_+_0.25rem)]" : "w-icon",
            )}
          >
            <QueueToggle
              task={task}
              queued={facts.queued}
              claims={facts.claims}
              onToggle={actions.toggleQueue}
              canEdit={canEdit}
              revealOnHover
            />
          </RowColumn>
        ) : null}
      </RowColumnsSlot>
    </Row>
  );

  const copyLink = () => {
    const target = handle ?? task.id;
    const url = `${window.location.origin}/tasks?id=${encodeURIComponent(target)}`;
    void navigator.clipboard?.writeText(url).then(
      () => toast("Link copied"),
      () => toast.error("Couldn’t copy."),
    );
  };
  const copyText = () => {
    const text = handle ? `${task.title || "Untitled"} (${handle})` : task.title || "Untitled";
    void navigator.clipboard?.writeText(text).then(
      () => toast("Copied"),
      () => toast.error("Couldn’t copy."),
    );
  };

  if (!canEdit) {
    // Read-only (research §9): open it, or take it elsewhere.
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem onSelect={() => onSelect(task.id)}>Open</ContextMenuItem>
          <ContextMenuItem onSelect={copyLink}>Copy link</ContextMenuItem>
          <ContextMenuItem onSelect={copyText}>Copy as text</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

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
        <ContextMenuItem onSelect={() => afterMenuClose(() => onStartEdit(task.id))}>
          Rename
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => activateGlyph(task, actions)}>
          {done ? "Mark not done" : closed ? "Reopen" : "Mark done"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => afterMenuClose(() => onRequestCommand(task.id, "status"))}>
          Status…
        </ContextMenuItem>
        {!closed && task.status !== "archived" ? (
          <ContextMenuItem onSelect={() => actions.toggleQueue(task.id)}>
            {queued ? "Remove from queue" : "Add to queue"}
          </ContextMenuItem>
        ) : null}
        {task.recurrence && !closed ? (
          <ContextMenuItem onSelect={() => actions.skipOccurrence(task.id)}>
            Skip occurrence
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => afterMenuClose(() => onRequestCommand(task.id, "schedule"))}
        >
          Schedule…
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => afterMenuClose(() => onRequestCommand(task.id, "due"))}>
          Set due date…
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => afterMenuClose(() => onRequestCommand(task.id, "bucket"))}>
          Move to project…
        </ContextMenuItem>
        {task.parentId ? (
          <ContextMenuItem onSelect={() => actions.setTaskParent(task.id, null)}>
            Detach from parent
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <AssignContextMenu task={task} api={actions} />
        <ContextMenuSub>
          <ContextMenuSubTrigger>Priority</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              value={task.priority ?? "none"}
              onValueChange={(v) =>
                actions.patchTask(task.id, {
                  priority: v === "none" ? null : (v as PriorityLevel),
                })
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
                actions.patchTask(task.id, {
                  energyLevel: v === "none" ? null : (v as EnergyLevel),
                })
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
        <ContextMenuItem onSelect={copyLink}>Copy link</ContextMenuItem>
        <ContextMenuItem variant="destructive" onSelect={() => actions.deleteTask(task.id)}>
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
      // Bare and in the row title's own face and size, so the text doesn't
      // change when editing starts (content, not chrome: R4).
      variant="bare"
      size="sm"
      className="font-sans text-md"
    />
  );
}

/** Detailed's assignee cell: the first name ("Mike" of "Mike Grochowski"; "Me" stays). */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
