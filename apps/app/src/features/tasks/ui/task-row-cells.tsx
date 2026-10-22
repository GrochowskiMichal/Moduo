// The List row's cells (TV-U10), on the kit Row: the status glyph and its
// menu, the handle, the project menu, the date cells, and a late row's fixes.
// Each takes what it shows and id-taking callbacks only (TV-D11b: a memoised
// row never holds the module API or a whole list).

import { isClosedTask, taskCategoryOf, type TaskStatusCategory } from "@contracts/vocabularies";
import { CalendarPlus, Clock } from "lucide-react";
import type * as React from "react";
import { toast } from "sonner";

import { DatePickerPanel, useDateDraft } from "../../../components/ui/date-field";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import type { Task } from "../model";
import { dueLabel, type RowDate, rowDate, sessionLabel } from "../row-layout";
import type { StatusTarget } from "../statuses";
import { nowOn } from "../use-today";
import { ProjectMenuItems, StatusMenuItems } from "./project-choices";
import type { TaskRowActions } from "./row-facts";
import { StatusIcon } from "./status-icon";
import { BucketLabel, DateMark } from "./task-meta";

// Closing a row popover hands focus back to the list (onClearCommand). Without
// this, Radix moves it to the chip once the popover unmounts after a click on
// the chip itself.
const keepListFocus = (e: Event) => e.preventDefault();

const CELL_BUTTON = cn(
  "rounded-sm transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
);

// ── The status glyph (default k) ───────────────────────────────────────────

/** What a click on the glyph does: finish an open task, reopen a closed one. */
export function glyphAction(task: Pick<Task, "status" | "statusCategory">): "finish" | "reopen" {
  return isClosedTask(task) ? "reopen" : "finish";
}

/** The glyph's name: what a click will do. */
export function glyphLabel(task: Pick<Task, "status" | "statusCategory">): string {
  const category = taskCategoryOf(task);
  if (category === "done") return "Mark as not done";
  if (category === "wont_do") return "Reopen";
  return "Mark as done";
}

/**
 * The row's lead control (REPLAN 53a, default k): the category's icon. A click
 * finishes the task from any open category (Backlog and In progress too); on a
 * Done or Won't do task it reopens it (to To do: the server keeps no earlier
 * status). Right-click, ⇧S or "Status…" open the status menu, anchored here.
 * Read-only, it names the status (tooltip and screen reader) and does nothing.
 */
export function StatusGlyph({
  task,
  statusName,
  canEdit,
  menuOpen,
  onMenuOpenChange,
  onActivate,
  onPickStatus,
}: {
  task: Task;
  statusName: string;
  canEdit: boolean;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onActivate: () => void;
  onPickStatus: (target: StatusTarget) => void;
}) {
  const category = taskCategoryOf(task);
  const tone = glyphTone(category);
  if (!canEdit) {
    // Read-only: the status, named and shown, with nothing to press.
    return (
      <span className="relative flex size-icon shrink-0 items-center justify-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              role="img"
              data-slot="row-status"
              aria-label={statusName}
              className={cn("hit-min flex size-icon-sm items-center justify-center", tone)}
            >
              <StatusIcon category={category} />
            </span>
          </TooltipTrigger>
          <TooltipContent>{statusName}</TooltipContent>
        </Tooltip>
      </span>
    );
  }
  return (
    <span className="relative flex size-icon shrink-0 items-center justify-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-slot="row-status"
            aria-pressed={isClosedTask(task)}
            aria-label={glyphLabel(task)}
            onClick={(e) => {
              e.stopPropagation();
              onActivate();
            }}
            onContextMenu={(e) => {
              // The status menu, not the row's menu.
              e.preventDefault();
              e.stopPropagation();
              onMenuOpenChange(true);
            }}
            className={cn(
              // hit-min pads the pointer target to 24 px; the glyph stays 16.
              "hit-min flex size-icon-sm items-center justify-center rounded-full",
              "transition-colors duration-(--motion-fade) ease-(--ease-out)",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              tone,
              !isClosedTask(task) && "hover:text-foreground",
            )}
          >
            <StatusIcon category={category} />
          </button>
        </TooltipTrigger>
        <TooltipContent>{statusName}</TooltipContent>
      </Tooltip>
      {/* Not modal, like the row's other menus: a trapped focus scope would
          pull focus back from the list when Esc hands it there. */}
      <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange} modal={false}>
        <DropdownMenuTrigger asChild>
          {/* The menu's anchor: the glyph's box, out of sight and reach (a
                click on the glyph finishes, it never opens the menu). */}
          <span aria-hidden className="pointer-events-none absolute inset-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-56"
          align="start"
          onClick={(e) => e.stopPropagation()}
          onCloseAutoFocus={keepListFocus}
        >
          <StatusMenuItems task={task} onPick={onPickStatus} />
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

/** The glyph's colour: Done's check is the accent's (budget: selection >
 *  today > done check), Won't do and Backlog the quietest. */
function glyphTone(category: TaskStatusCategory): string {
  switch (category) {
    case "done":
      return "text-primary";
    case "wont_do":
    case "backlog":
      return "text-subtle-foreground";
    default:
      return "text-muted-foreground";
  }
}

// ── The handle (decision 4) ────────────────────────────────────────────────

/** `MOD-142` before the title (Detailed): click copies it. */
export function HandleCell({ handle }: { handle: string | null }) {
  return (
    // Every sized cell is in the cells' face (text-xs), so its `ch` width is
    // the list's (the header's cells are too).
    <span
      data-col="handle"
      className="flex shrink-0 items-center font-sans text-xs min-w-(--tl-col-handle)"
    >
      {handle ? (
        <button
          type="button"
          aria-label={`Copy ${handle}`}
          onClick={(e) => {
            e.stopPropagation();
            void navigator.clipboard?.writeText(handle).then(
              () => toast(`Copied ${handle}`),
              () => toast.error("Couldn’t copy."),
            );
          }}
          className={cn(
            CELL_BUTTON,
            "-mx-1 px-1 font-sans text-xs whitespace-nowrap text-subtle-foreground tabular-nums hover:text-muted-foreground",
          )}
        >
          {handle}
        </button>
      ) : null}
    </span>
  );
}

// ── The project menu (Standard inline, Detailed column, or implied) ─────────

/**
 * The task's project and the way to move it (`b`, the menu's "Move to
 * project…"). Standard shows dot + name after the counts where the scope
 * doesn't imply it; Detailed shows "Project › Section" in its own column;
 * where it's implied the trigger stays, taking no width and out of reach, so
 * `b` still anchors the menu (R6: never `hidden → flex`).
 */
export function ProjectMenu({
  task,
  inboxId,
  projectName,
  sectionName,
  variant,
  canEdit,
  open,
  onOpenChange,
  actions,
  className,
}: {
  task: Task;
  inboxId: string | null;
  projectName: string;
  sectionName: string | null;
  variant: "inline" | "column" | "implied";
  canEdit: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: Pick<TaskRowActions, "patchTask">;
  /** The trigger's place in its line (a List row lets the name give way). */
  className?: string;
}) {
  const isInbox = task.bucketId === inboxId;
  const label =
    variant === "column" ? (
      <span className="flex min-w-0 items-center gap-1.5 font-sans text-xs text-muted-foreground">
        <span className="min-w-0 text-left break-words">
          {projectName}
          {sectionName ? <span className="text-subtle-foreground"> › {sectionName}</span> : null}
        </span>
      </span>
    ) : (
      <BucketLabel name={projectName} isInbox={isInbox} className="max-w-56" />
    );
  const implied = variant === "implied";
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild disabled={!canEdit}>
        <button
          type="button"
          data-col={variant === "column" ? "project" : undefined}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Project: ${projectName}${sectionName ? ` › ${sectionName}` : ""}`}
          tabIndex={implied ? -1 : undefined}
          aria-hidden={implied ? true : undefined}
          data-implied={implied ? "" : undefined}
          className={cn(
            "flex min-w-0 rounded-sm px-1 transition-colors duration-(--motion-fade) ease-(--ease-out)",
            canEdit && "hover:bg-state-hover",
            variant === "inline" && "shrink-0",
            variant === "column" &&
              "shrink-0 items-center font-sans text-xs min-w-(--tl-col-project) max-w-(--tl-col-project)",
            // Takes no width and gives back the row's gap, so nothing shifts.
            implied && "pointer-events-none -ms-2.5 w-0 overflow-hidden px-0 opacity-0",
            className,
          )}
        >
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-48"
        onClick={(e) => e.stopPropagation()}
        onCloseAutoFocus={keepListFocus}
        align={variant === "column" ? "start" : "end"}
      >
        <DropdownMenuRadioGroup
          value={task.bucketId ?? ""}
          onValueChange={(id) => {
            if (id !== task.bucketId) actions.patchTask(task.id, { bucketId: id });
          }}
        >
          {/* The view's projects, read only while the menu is open (TV-D11b). */}
          <ProjectMenuItems />
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Date cells ──────────────────────────────────────────────────────────────

/** Which date a cell shows: Standard's one date, or Detailed's Due / Next session. */
export type DateCellKind = "row" | "due" | "session";

/**
 * A date cell and the way to edit it. Standard's ("row") shows the next
 * session or the due date, whichever comes first by day, and edits that one;
 * Detailed's two cells show and edit the due date and the next session.
 * A click opens the editor; `s` / `d` and the menu open it too. An empty cell
 * holds its width and, on hover, offers a calendar glyph (default i): the due
 * date's picker (the session's in Next session).
 */
export function DateCell({
  task,
  kind,
  canEdit,
  command,
  today,
  onRequestCommand,
  onClearCommand,
  actions,
  label = null,
}: {
  task: Task;
  kind: DateCellKind;
  /** The view's own words for Standard's date (Upcoming's "3:00 PM · 45m"). */
  label?: string | null;
  canEdit: boolean;
  /** The editor the keyboard or the menu asked for, if any. */
  command: "schedule" | "due" | null;
  /** Today's date key: the labels are worked out against it. */
  today: string;
  onRequestCommand: (command: "schedule" | "due") => void;
  onClearCommand: () => void;
  actions: Pick<TaskRowActions, "patchTask">;
}) {
  const now = nowOn(today);
  const shown = cellDate(task, kind, now, label);
  const col = kind === "row" ? "date" : kind;
  const width =
    kind === "row"
      ? "min-w-(--tl-col-date)"
      : kind === "due"
        ? "min-w-(--tl-col-due)"
        : "min-w-(--tl-col-session)";
  const cell = cn("flex shrink-0 items-center justify-end font-sans text-xs", width);
  // Which editor a click opens: the asked one, else the shown date's.
  const editing: "schedule" | "due" =
    command ?? (kind === "session" ? "schedule" : kind === "due" ? "due" : (shown?.edit ?? "due"));
  // One save when the popover closes (TV-P0): a scheduled time goes through
  // the reschedule op, so it lands in the task's trail.
  const current = editing === "schedule" ? task.scheduledAt : task.dueDate;
  const draft = useDateDraft({
    value: current ? new Date(current) : null,
    onChange: (d) =>
      actions.patchTask(
        task.id,
        editing === "schedule"
          ? { scheduledAt: d ? d.toISOString() : null }
          : { dueDate: d ? d.toISOString() : null },
      ),
    withTime: editing === "schedule",
    open: command !== null,
    done: onClearCommand,
  });
  const name = shown ? shown.description : editing === "due" ? "Due date" : "Scheduled time";

  if (!canEdit) {
    return (
      <span data-col={col} className={cell}>
        {shown ? (
          <DateTip label={shown.description}>
            <span role="img" aria-label={name} className="flex min-w-0 items-center">
              {shown.mark}
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
        data-col={col}
        data-empty={shown ? undefined : ""}
        onClick={(e) => e.stopPropagation()}
        aria-label={name}
        className={cn(cell, CELL_BUTTON, "group/date px-1")}
      >
        {shown ? (
          shown.mark
        ) : (
          // An empty cell offers its picker on hover only (default i).
          <CalendarPlus
            aria-hidden
            className={cn(
              "size-icon-xs text-subtle-foreground opacity-0 transition-opacity duration-(--motion-fade) ease-(--ease-out)",
              "group-hover/row:opacity-100 group-focus-visible/date:opacity-100",
            )}
          />
        )}
      </button>
    </PopoverTrigger>
  );

  return (
    <Popover
      open={command !== null}
      onOpenChange={(o) => (o ? onRequestCommand(editing) : draft.close())}
    >
      {shown ? <DateTip label={shown.description}>{trigger}</DateTip> : trigger}
      <PopoverContent
        className="w-auto p-0"
        onClick={(e) => e.stopPropagation()}
        onCloseAutoFocus={keepListFocus}
        onEscapeKeyDown={draft.cancel}
        align="end"
      >
        <DatePickerPanel
          draft={draft}
          heading={editing === "schedule" ? "Scheduled time" : "Due date"}
        />
      </PopoverContent>
    </Popover>
  );
}

/** What a date cell shows, its full description, and the editor it opens. */
function cellDate(
  task: Task,
  kind: DateCellKind,
  now: Date,
  viewLabel: string | null = null,
): { mark: React.ReactNode; description: string; edit: "schedule" | "due" } | null {
  if (kind === "row") {
    const date: RowDate | null = rowDate(task, now);
    if (!date) {
      // A view's own words for a dateless row (a snoozed task's "until Fri").
      if (!viewLabel) return null;
      return { mark: <DateText>{viewLabel}</DateText>, description: viewLabel, edit: "due" };
    }
    return {
      mark: <DateMark date={viewLabel ? { ...date, label: viewLabel } : date} />,
      description: date.description,
      edit: date.kind === "due" ? "due" : "schedule",
    };
  }
  if (kind === "due") {
    const label = dueLabel(task, now);
    if (!label || !task.dueDate) return null;
    return {
      mark: <DateText>{label}</DateText>,
      description: `Due ${label}`,
      edit: "due",
    };
  }
  const label = sessionLabel(task, now);
  if (!label) return null;
  return {
    mark: (
      <DateText>
        <Clock className="size-icon-xs shrink-0" aria-hidden />
        {label}
      </DateText>
    ),
    description: `Next session ${label}`,
    edit: "schedule",
  };
}

function DateText({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1 font-sans text-xs whitespace-nowrap text-muted-foreground tabular-nums">
      {children}
    </span>
  );
}

/** The full dates behind the short label. */
function DateTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// ── A late row's fixes (REPLAN 23) ─────────────────────────────────────────

/**
 * Move · Won't do · Break down: what a late row offers on hover or when
 * selected, in the counts' place (default i). Break down is a top-level
 * task's only (a subtask has no subtasks).
 */
export function LateFixes({
  onMove,
  onWontDo,
  onBreakDown,
  className,
}: {
  onMove: () => void;
  onWontDo: () => void;
  onBreakDown: (() => void) | null;
  className?: string;
}) {
  const fix = (label: string, run: () => void) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        run();
      }}
      className={cn(
        CELL_BUTTON,
        "px-1 font-sans text-xs whitespace-nowrap text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
  return (
    <span data-slot="row-late-fixes" className={cn("flex items-center gap-0.5", className)}>
      {fix("Move", onMove)}
      <span aria-hidden className="text-subtle-foreground">
        ·
      </span>
      {fix("Won’t do", onWontDo)}
      {onBreakDown ? (
        <>
          <span aria-hidden className="text-subtle-foreground">
            ·
          </span>
          {fix("Break down", onBreakDown)}
        </>
      ) : null}
    </span>
  );
}
