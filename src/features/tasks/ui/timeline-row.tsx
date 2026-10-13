// One Timeline row (TV-TL1, REPLAN 67–69): a sticky name cell on the left
// (titles live there, so a bar never cuts one) and the track on the right,
// where the row's marks sit on the shared time axis. Memoised (TV-D11b): a
// row takes its row, a few flags and one actions object that never changes,
// so editing one task redraws one row.

import { ChevronDown, ChevronRight } from "lucide-react";
import { memo, type ReactNode } from "react";

import { normalizeLabelColor } from "../../../components/tag-colors";
import { useTimeRegion } from "../../../lib/time-region";
import { cn } from "../../../lib/utils";
import { useAssignees } from "../assignees";
import type { TimelineRow } from "../timeline-rows";
import { barWords, milestoneWords, pointWords, sectionDateWords } from "../timeline-words";
import { AssigneeAvatar } from "./assignee-avatar";
import type { TaskRowActions } from "./row-facts";
import { type TaskCommand, TaskContextMenu } from "./task-context-menu";
import { TitleEditor } from "./task-row";
import {
  OffscreenHint,
  ProjectBarMark,
  RepeatGhosts,
  SectionBand,
  SectionDiamond,
  SessionTicks,
  TaskPointMark,
  TrackLines,
  useTimelineGeometry,
} from "./timeline-marks";
import { TimelineTaskCommand } from "./timeline-row-commands";

/** What a row can ask of the view: one object for the life of the view. */
export type TimelineRowHandlers = {
  /** A click: the row takes the cursor (a task row is selected). */
  activate: (row: TimelineRow) => void;
  /** ▸ / ▾ on a project or a section. */
  toggle: (rowKey: string) => void;
  /** Open a project's own Timeline (a project row at All). */
  openProject: (projectId: string) => void;
  /** The context menu's Open: select the task (its details in the panel). */
  openTask: (taskId: string) => void;
  startRename: (taskId: string) => void;
  endRename: (taskId: string, title: string | null) => void;
  requestCommand: (taskId: string, command: TaskCommand) => void;
  clearCommand: () => void;
  /** Hand the keyboard back to the view (a menu or an editor closed). */
  refocus: () => void;
  /** Scroll sideways to a day (an off-screen hint's click). */
  scrollToDay: (day: number) => void;
};

export type TimelineRowProps = {
  row: TimelineRow;
  /** The task is the page's selection. */
  selected: boolean;
  /** The keyboard's place. */
  cursor: boolean;
  /** Stuck under the time header: an opaque surface over the rows below. */
  sticky: boolean;
  canEdit: boolean;
  /** In my Focus line-up (the menu's Add / Remove). */
  queued: boolean;
  /** The project's hue (its dot, its bar's cap, Colour by project). */
  hue: string | null;
  /** Show repeats: ghost points for the coming occurrences. */
  showRepeats: boolean;
  /** The menu asked for this task's picker. */
  command: TaskCommand | null;
  /** The menu's Rename is editing this task's title. */
  editing: boolean;
  taskKey: string | null;
  handlers: TimelineRowHandlers;
  actions: TaskRowActions;
};

/** The DOM id of a row (the grid's active descendant). */
export function timelineRowDomId(key: string): string {
  return `timeline-row-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/** Where a row's content starts: one step per level; tasks line up with their header's name. */
function indentOf(row: TimelineRow): number {
  if (row.kind === "area") return 16;
  if (row.kind === "group") return 12;
  if (row.kind === "task") return Math.max(12, 28 + (row.depth - 1) * 16);
  return 8 + row.depth * 16;
}

function TimelineRowView(props: TimelineRowProps) {
  // Dates redraw when Time & region changes (TV-D14; the row is memoised).
  useTimeRegion();
  const { row, selected, cursor, sticky, canEdit, handlers } = props;
  const { nameHidden, zoom } = useTimelineGeometry();
  const header = row.kind === "area" || row.kind === "group" || row.kind === "section";
  const expandable = row.kind === "project" ? row.expandable : row.kind === "section";
  const expanded =
    row.kind === "project" ? row.expanded : row.kind === "section" ? !row.folded : undefined;

  const body = (
    <div
      id={timelineRowDomId(row.key)}
      role="row"
      aria-selected={selected || cursor}
      aria-level={row.kind === "area" || row.kind === "group" ? 1 : depthOf(row) + 1}
      aria-expanded={expandable ? expanded : undefined}
      data-timeline-row={row.kind}
      data-row-key={row.key}
      data-cursor={cursor || undefined}
      onClick={() => handlers.activate(row)}
      onDoubleClick={() => {
        if (row.kind === "project" && row.expandable) handlers.openProject(row.project.id);
      }}
      className={cn(
        "group/row relative flex w-full cursor-default select-none",
        header ? "h-(--row-h-sm)" : "h-(--row-h)",
        // A row stuck under the header covers the ones passing beneath.
        sticky && "bg-card",
      )}
    >
      <NameCell {...props} expandable={expandable} expanded={!!expanded} />
      <div
        role="gridcell"
        // Stuck, the row is opaque: its track paints the canvas's grid itself
        // (the frame holds the grid's geometry).
        className={cn("relative min-w-0 flex-1", sticky && "timeline-grid")}
        data-unit={
          sticky ? (zoom === "year" ? "month" : zoom === "quarter" ? "week" : "day") : undefined
        }
        data-weekends={sticky && (zoom === "week" || zoom === "month") ? "" : undefined}
      >
        {/* Hover and selection tint the whole row (69: accent only for the selection). */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0",
            selected
              ? "bg-state-selected"
              : cursor
                ? "bg-state-active"
                : "group-hover/row:bg-state-hover",
          )}
        />
        {sticky ? <TrackLines /> : null}
        <Track {...props} />
        {nameHidden ? <TrackLabel row={row} /> : null}
      </div>
    </div>
  );

  if (row.kind !== "task") return body;
  return (
    <TaskContextMenu
      task={row.task}
      facts={{ queued: props.queued }}
      canEdit={canEdit}
      taskKey={props.taskKey}
      actions={props.actions}
      onOpen={handlers.openTask}
      onRename={handlers.startRename}
      onRequestCommand={handlers.requestCommand}
    >
      {body}
    </TaskContextMenu>
  );
}

function depthOf(row: TimelineRow): number {
  return row.kind === "project" || row.kind === "section" || row.kind === "task" ? row.depth : 0;
}

function NameCell({
  row,
  selected,
  cursor,
  hue,
  command,
  editing,
  canEdit,
  handlers,
  actions,
  expandable,
  expanded,
}: TimelineRowProps & { expandable: boolean; expanded: boolean }) {
  const { nameHidden } = useTimelineGeometry();
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div
      role="rowheader"
      className={cn(
        // Sticky on the left (69): the title is always readable, never cut by a bar.
        "sticky left-0 z-[2] flex h-full w-(--timeline-name-w) shrink-0 items-center gap-2 overflow-hidden bg-card",
        // ⇧[ folds it to nothing (the name stays for screen readers).
        nameHidden ? "border-0 p-0" : "border-r border-hairline pe-3",
      )}
      style={nameHidden ? undefined : { paddingInlineStart: indentOf(row) }}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0",
          selected
            ? "bg-state-selected"
            : cursor
              ? "bg-state-active"
              : "group-hover/row:bg-state-hover",
        )}
      />
      {row.kind === "project" || row.kind === "section" ? (
        expandable ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={expanded ? "Fold" : "Unfold"}
            onClick={(e) => {
              e.stopPropagation();
              handlers.toggle(row.key);
            }}
            className="relative flex size-icon-xs shrink-0 items-center justify-center rounded-sm text-subtle-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:text-foreground"
          >
            <Chevron className="size-icon-xs" aria-hidden />
          </button>
        ) : (
          <span aria-hidden className="size-icon-xs shrink-0" />
        )
      ) : null}
      <NameContent row={row} hue={hue} editing={editing} canEdit={canEdit} handlers={handlers} />
      {row.kind === "task" && command ? (
        <TimelineTaskCommand
          task={row.task}
          command={command}
          actions={actions}
          onDone={handlers.clearCommand}
          refocus={handlers.refocus}
        />
      ) : null}
    </div>
  );
}

function NameContent({
  row,
  hue,
  editing,
  canEdit,
  handlers,
}: Pick<TimelineRowProps, "row" | "hue" | "editing" | "canEdit" | "handlers">) {
  const { byId } = useAssignees();
  switch (row.kind) {
    case "area":
      return (
        <span className="relative min-w-0 truncate font-sans text-sm font-medium text-muted-foreground">
          {row.label}
        </span>
      );
    case "group":
      return (
        <span className="relative flex min-w-0 items-center gap-2">
          {row.color ? (
            <span
              aria-hidden
              data-label={normalizeLabelColor(row.color)}
              className="tag-dot size-2 shrink-0 rounded-full"
            />
          ) : null}
          <span className="min-w-0 truncate font-sans text-sm font-medium text-foreground">
            {row.label}
          </span>
          <span className="shrink-0 font-sans text-xs tabular-nums text-subtle-foreground">
            {row.count}
          </span>
        </span>
      );
    case "project":
      return (
        <span className={cn("relative flex min-w-0 items-center gap-2", row.muted && "opacity-60")}>
          <span
            aria-hidden
            data-label={normalizeLabelColor(hue)}
            className="tag-dot size-2 shrink-0 rounded-full"
          />
          <span className="min-w-0 truncate font-sans text-base font-medium text-foreground">
            {row.project.name}
          </span>
        </span>
      );
    case "section": {
      const dates = sectionDateWords(row.band, row.milestone);
      return (
        <span className="relative flex min-w-0 items-baseline gap-1.5">
          <span className="min-w-0 truncate font-sans text-sm font-medium text-foreground">
            {row.section ? row.section.name || "Untitled section" : "No section"}
          </span>
          {/* The counts and dates never truncate (research §3). */}
          {row.total > 0 || dates ? (
            <span className="shrink-0 font-sans text-xs whitespace-nowrap tabular-nums text-subtle-foreground">
              {[row.total > 0 ? `${row.done} of ${row.total}` : null, dates]
                .filter(Boolean)
                .map((part) => `· ${part}`)
                .join(" ")}
            </span>
          ) : null}
        </span>
      );
    }
    case "task": {
      const { task } = row;
      const closed = row.point?.closed ?? false;
      if (editing && canEdit) {
        return (
          <span className="relative min-w-0 flex-1">
            <TitleEditor
              initial={task.title}
              className="font-sans text-sm"
              onCommit={(title) => handlers.endRename(task.id, title)}
              onCancel={() => handlers.endRename(task.id, null)}
            />
          </span>
        );
      }
      const assignee = byId(task.assigneeId);
      return (
        <>
          <span
            className={cn(
              "relative min-w-0 flex-1 truncate font-sans text-sm",
              closed ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {task.title || "Untitled"}
          </span>
          {task.assigneeId ? (
            <AssigneeAvatar
              assignee={assignee}
              assigneeId={task.assigneeId}
              size="icon"
              className="relative shrink-0"
            />
          ) : null}
        </>
      );
    }
  }
}

/** The marks on a row's track. */
function Track({ row, selected, hue, showRepeats, handlers }: TimelineRowProps) {
  switch (row.kind) {
    case "area":
    case "group":
      return null;
    case "project":
      return row.bar ? (
        <>
          <ProjectBarMark
            projectId={row.project.id}
            bar={row.bar}
            color={hue}
            progress={row.progress}
            showMilestones={row.expandable && !row.expanded}
            muted={row.muted}
            label={barWords(row.bar, row.progress)}
            milestoneLabel={milestoneWords}
          />
          <OffscreenHint start={row.bar.start} end={row.bar.end} onGo={handlers.scrollToDay} />
        </>
      ) : null;
    case "section":
      return (
        <>
          {row.band ? <SectionBand band={row.band} sectionId={row.section?.id ?? null} /> : null}
          {row.milestone !== null && row.section ? (
            <SectionDiamond
              day={row.milestone}
              sectionId={row.section.id}
              label={milestoneWords(row.section.name, row.milestone)}
            />
          ) : null}
          {row.band || row.milestone !== null ? (
            <OffscreenHint
              start={row.band?.start ?? row.milestone ?? 0}
              end={row.band?.end ?? row.milestone ?? 0}
              onGo={handlers.scrollToDay}
            />
          ) : null}
        </>
      );
    case "task": {
      const { task, point } = row;
      return (
        <>
          {row.band ? <SectionBand band={row.band} sectionId={task.sectionId ?? null} /> : null}
          {row.sessionDays.length > 0 ? <SessionTicks days={row.sessionDays} /> : null}
          {showRepeats && task.recurrence && !point?.closed ? (
            <RepeatGhosts
              recurrence={task.recurrence}
              createdAt={task.createdAt}
              skipDay={point?.day ?? null}
            />
          ) : null}
          {point ? (
            <>
              <TaskPointMark
                point={point}
                taskId={task.id}
                tone={{ hue, category: task.statusCategory ?? task.status }}
                selected={selected}
                label={pointWords(point)}
              />
              <OffscreenHint start={point.day} end={point.day} onGo={handlers.scrollToDay} />
            </>
          ) : null}
        </>
      );
    }
  }
}

/**
 * ⇧[ hid the name column (research §3): the title sits right of its mark, a
 * header's name at the left edge of the canvas.
 */
function TrackLabel({ row }: { row: TimelineRow }) {
  const { range, dw } = useTimelineGeometry();
  let text: ReactNode = null;
  let at: number | null = null;
  if (row.kind === "task") {
    text = row.task.title || "Untitled";
    at = row.point ? (row.point.day - range.start + 1) * dw + 8 : null;
  } else if (row.kind === "project") {
    text = row.project.name;
    at = row.bar ? (row.bar.end - range.start + 1) * dw + 8 : null;
  } else if (row.kind === "section") {
    text = row.section ? row.section.name || "Untitled section" : "No section";
  } else {
    text = row.label;
  }
  const className =
    "pointer-events-none absolute top-1/2 -translate-y-1/2 font-sans text-xs whitespace-nowrap text-muted-foreground";
  if (at === null) {
    return (
      <span className="pointer-events-none sticky left-2 flex h-full w-fit items-center font-sans text-xs font-medium whitespace-nowrap text-muted-foreground">
        {text}
      </span>
    );
  }
  return (
    <span className={className} style={{ left: at }}>
      {text}
    </span>
  );
}

function sameRowProps(a: TimelineRowProps, b: TimelineRowProps): boolean {
  return (
    a.row === b.row &&
    a.selected === b.selected &&
    a.cursor === b.cursor &&
    a.sticky === b.sticky &&
    a.canEdit === b.canEdit &&
    a.queued === b.queued &&
    a.hue === b.hue &&
    a.showRepeats === b.showRepeats &&
    a.command === b.command &&
    a.editing === b.editing &&
    a.taskKey === b.taskKey &&
    a.handlers === b.handlers &&
    a.actions === b.actions
  );
}

export const TimelineRowItem = memo(TimelineRowView, sameRowProps);
