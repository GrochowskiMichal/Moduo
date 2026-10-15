import { isClosedTask } from "@contracts/vocabularies";
import type { DraggableSyntheticListeners } from "@dnd-kit/core";
import { ChevronDown, ChevronRight, CornerDownRight } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Row, RowColumn, RowColumns as RowColumnsSlot } from "../../../components/ui/row";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { useTimeRegion } from "../../../lib/time-region";
import { cn } from "../../../lib/utils";
import { agentRowMarkParts } from "../../spine/agent-session";
import { assigneeLabel } from "../assignee-options";
import { useAssignees } from "../assignees";
import { requestBreakDown } from "../break-down";
import { isLate, type Task } from "../model";
import {
  ALL_ROW_COLUMNS,
  handleLabel,
  type RowColumns,
  rowTime,
  updatedLabel,
} from "../row-layout";
import { type SelectMods, selectModsOf } from "../selection";
import { nowOn } from "../use-today";
import { AssigneeAvatar } from "./assignee-avatar";
import type { DragActivatorRef } from "./dnd/task-dnd";
import { EnergyMark, PriorityMark } from "./level-icons";
import { ROW_TITLE_ATTR } from "./list-keys";
import { QueueToggle } from "./queue-toggle";
import { sameTaskFacts, sameValues, type TaskFacts, type TaskRowActions } from "./row-facts";
import { activateTask, type TaskCommand, TaskContextMenu } from "./task-context-menu";
import { hasTaskCounts, TaskCounts } from "./task-meta";
import { DateCell, HandleCell, LateFixes, ProjectMenu, StatusGlyph } from "./task-row-cells";

// The blocked marker moved to task-meta; the Timeline still imports it here.
export { BlockedMarker } from "./task-meta";

/** Which inline menu or popover the keyboard asked to open on this row. */
export type RowCommand = TaskCommand | null;

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
  /** Callbacks take the task's id, so one function serves every row. A
   *  click passes its ⇧ / ⌘ (a range, one more: multi-select, TV-U12). */
  onSelect: (taskId: string, mods?: SelectMods) => void;
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
 * [handle] · title · [project] … the agent's mark and the quiet counts,
 * pinned beside the columns in Standard (MOD-138), right after the title in
 * Detailed; then the columns (Standard: priority · date · avatar · Focus
 * mark; Detailed adds what Display → Columns has on: Project › Section, the
 * status name, Due and Next session, time, waiting, the assignee's name and
 * updated). The title takes the free width and gives way first, never below
 * about ten characters (MOD-125); columns hold the list's widths, so nothing
 * in them truncates. Hover shows only the Focus mark, an empty date cell's
 * picker and a late row's fixes (default i). A closed row fades as a whole
 * except its status icon; selection is the tint (DS-2), never a bar.
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
export const activateGlyph: (task: Task, actions: TaskRowActions) => void = activateTask;

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
  // Dates and times redraw when Time & region changes (TV-D14): this row is
  // memoised on its facts, which don't carry the setting.
  useTimeRegion();
  // A Won't do task kept in view (TV-P0) reads closed, like a done one.
  const closed = isClosedTask(task);
  const late = isLate(task, today);
  // Blocked — computed, ambient: dim + a quiet icon, never red (spec §5c).
  const blocked = facts.blockedLabel !== null;
  const { assignees, byId } = useAssignees();
  const assignee = byId(task.assigneeId);
  const assigneeName = assigneeLabel(task.assigneeId, byId);
  // Solo workspaces have nobody to tell apart — the avatar only appears with teammates.
  const withAssignee = columns.assignee && showAssignee && assignees.length > 1;
  // The preset itself: any of Detailed's own columns can be off (MOD-128).
  const detailed = columns.detailed;
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
      // Beside a title at its floor the project's name gives way, like the
      // Inbox's source (MOD-125); a card's wraps instead.
      className={variant === "inline" ? "min-w-0 shrink-3 overflow-hidden" : undefined}
    />
  );
  const title = task.title || "Untitled";
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
  // A late row's fixes, on hover or selection: they fade in and take no room
  // from the title (R6: nothing reflows), on the row's own surface so the
  // title doesn't show through. `side` places them: beside Standard's pinned
  // details, or over the cell's end.
  const fixesOver = (side: string) =>
    fixes ? (
      <span
        className={cn(
          "absolute inset-y-0 flex items-center bg-card",
          side,
          "invisible opacity-0 transition-[opacity,visibility] duration-(--motion-fade) ease-(--ease-out)",
          "group-hover/row:visible group-hover/row:opacity-100",
          "group-data-[selected]/row:visible group-data-[selected]/row:opacity-100",
        )}
      >
        <span className="flex h-full items-center ps-2 group-hover/row:bg-state-hover group-data-[selected]/row:bg-state-selected">
          {fixes}
        </span>
      </span>
    ) : null;
  // The details after a title, as one group (round-2b's `.ind`): the agent's
  // mark, then tags · files · comments · subtasks · blocked · waiting ·
  // repeats · waiting to sync. Once the title is at its floor they give way:
  // the agent's words first, down to its dot, then the counts, whole and from
  // the start, so they never run under the columns.
  const hasCounts = hasTaskCounts(task, facts, { waitingColumn: columns.waiting });
  const hasDetails = !!facts.agent || hasCounts;
  // Clipped sideways: with no room at all (a cell under the title's floor)
  // even the agent's dot stays inside it, never over the columns.
  const detailsBody = hasDetails ? (
    <span className="flex min-w-0 items-center gap-2.5 overflow-x-clip">
      {facts.agent ? <RowAgentMark mark={facts.agent} /> : null}
      {hasCounts ? (
        <span data-slot="row-details-counts" className={COUNTS_FROM_END}>
          {/* Each count is an item of its own, so each gives way whole. */}
          <TaskCounts
            task={task}
            facts={facts}
            tagNames={detailed}
            waitingColumn={columns.waiting}
            bare
          />
        </span>
      ) : null}
    </span>
  ) : null;
  const details = detailed ? (
    detailsBody ? (
      <span data-slot="row-details" className="flex min-w-0 items-center">
        {detailsBody}
      </span>
    ) : null
  ) : hasDetails || fixes ? (
    // Standard (MOD-138): pinned to the cell's end, beside the columns, so
    // they never move with the title's length; a late row's fixes sit
    // beside them, never over them.
    <span
      data-slot="row-details"
      className="relative ms-auto flex min-w-0 items-center self-stretch"
    >
      {fixesOver(hasDetails ? "end-full me-2.5" : "end-0")}
      {detailsBody}
    </span>
  ) : null;
  const fixesAtEnd = fixesOver("end-0");

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
      onClick={(e) => onSelect(task.id, selectModsOf(e))}
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
          // The title cell is the one flexible track: it takes the free width
          // (the checkpoint-1 fix). A container, so its details can shorten
          // when it's narrow (MOD-138).
          className="@container/title relative flex min-w-0 flex-1 items-center gap-2.5 group-data-[done]/row:opacity-50"
        >
          <button
            type="button"
            // Clicking the title selects the row, so its Space/Enter stay the
            // List's (complete / edit), unlike the row's other buttons.
            {...{ [ROW_TITLE_ATTR]: "" }}
            className={cn(
              // Body font (content, not chrome) at 15px — quiet, Linear/Todoist-ward.
              "truncate text-left font-sans text-md",
              // The title takes the room first and gives way first (call 42),
              // but never below about ten characters (MOD-125), nor wider than
              // its cell: from that floor it grows to its own width, so it
              // never stretches past its words. A shorter title just keeps
              // its width.
              title.length > TITLE_FLOOR_CHARS
                ? "min-w-[min(10ch,100%)] max-w-max flex-1"
                : "max-w-full shrink-0",
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
              onSelect(task.id, selectModsOf(e));
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (canEdit) onStartEdit(task.id);
            }}
          >
            {title}
          </button>
          {/* Detailed keeps the details right after the title (its own
              columns line up instead). */}
          {detailed ? details : null}
          {facts.source ? (
            // Where an Inbox task came from (research §7): quiet, after the
            // title; it gives way before the title does ("via Claude Desktop"
            // is long, TV-U13b).
            <span
              data-slot="row-source"
              className="min-w-0 shrink-3 truncate font-sans text-xs whitespace-nowrap text-muted-foreground"
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
          {/* Standard pins the details to the cell's end, beside the columns,
              so they stay put whatever the title's length (MOD-138). */}
          {detailed ? fixesAtEnd : details}
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

  // The one menu for rows, cards and bars (TV-U11): Open selects the row.
  return (
    <TaskContextMenu
      task={task}
      facts={facts}
      canEdit={canEdit}
      taskKey={taskKey}
      actions={actions}
      onOpen={onSelect}
      onRename={onStartEdit}
      onRequestCommand={onRequestCommand}
    >
      {row}
    </TaskContextMenu>
  );
}

// ── inline title editor ───────────────────────────────────────────────────────

export function TitleEditor({
  initial,
  onCommit,
  onCancel,
  className = "font-sans text-md",
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  /** The title's own face and size (a Board card's is smaller). */
  className?: string;
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
      className={className}
    />
  );
}

/**
 * A title longer than this many characters never shortens below about that
 * many (MOD-125: "Hero banner" read "H" beside an agent's mark); a shorter
 * one keeps its whole width.
 */
const TITLE_FLOOR_CHARS = 10;

/**
 * A row's counts give way whole, from their start (MOD-138): laid out from
 * the end (`flex-row-reverse`, each one's `order` its place from the end, so
 * they still read left to right in their own order) on one line, and what
 * doesn't fit wraps onto a second line the box hides (the row gap puts it
 * fully below). Tags go first; files and comments stay longest. Eight at
 * most (TaskCounts'). 20 px tall, so a dense row keeps its height and a
 * Detailed "+n" its focus ring.
 */
const COUNTS_FROM_END = cn(
  "flex h-5 min-w-0 flex-row-reverse flex-wrap items-center gap-x-2.5 gap-y-4 overflow-hidden py-px",
  "[&>:nth-last-child(1)]:order-1 [&>:nth-last-child(2)]:order-2 [&>:nth-last-child(3)]:order-3",
  "[&>:nth-last-child(4)]:order-4 [&>:nth-last-child(5)]:order-5 [&>:nth-last-child(6)]:order-6",
  "[&>:nth-last-child(7)]:order-7 [&>:nth-last-child(8)]:order-8",
);

/**
 * The agent's mark on a row (TV-D16, call 52; round-1c `.agent`): a dot, its
 * agent and what it's doing, "Claude · needs you" in the text colour, else
 * muted. As the title cell narrows it says less (MOD-125, MOD-138): under
 * 16rem its agent alone, under 12rem the dot; the tooltip and a screen reader
 * still say it all. The cut points are where a mark and one count would push
 * the title under its floor. In between it takes only the room the counts
 * leave (it starts at nothing and grows to its words), so its words give way
 * before any count, down to the dot.
 */
function RowAgentMark({ mark }: { mark: string }) {
  const { who, state, loud } = agentRowMarkParts(mark);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-slot="row-agent"
          data-tone={loud ? "loud" : "quiet"}
          className={cn(
            "flex min-w-3 max-w-max grow basis-0 items-center gap-1.5 font-sans text-xs whitespace-nowrap",
            loud ? "text-foreground" : "text-muted-foreground",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              loud ? "bg-foreground" : "bg-subtle-foreground",
            )}
          />
          <span className="min-w-0 truncate @max-[12rem]/title:sr-only">
            {who}
            {state ? <span className="@max-3xs/title:sr-only"> · {state}</span> : null}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{mark}</TooltipContent>
    </Tooltip>
  );
}

/** Detailed's assignee cell: the first name ("Mike" of "Mike Grochowski"; "Me" stays). */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
