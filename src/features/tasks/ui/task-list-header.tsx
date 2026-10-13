// Detailed's column headers (tasks-v3 §4, research §1/§3, TV-U10): one 28 px
// line above the List's rows, on the same widths (the list's `--tl-col-*`
// variables), so each label sits over its column. A sortable header sorts by
// its column: ascending, then descending, then back to the view's own order
// (`nextHeaderSort`). "+n" says how many columns were left out for room.

import { ArrowDown, ArrowUp } from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import type { OrderDirection, TaskOrder } from "../display";
import { COLUMN_LABELS, type RowColumns } from "../row-layout";
import { PriorityMark } from "./level-icons";

/** The columns a header can sort by. */
export type SortColumn = Exclude<TaskOrder, "manual" | "created">;

const LABEL = "font-sans text-xs whitespace-nowrap text-subtle-foreground";

export function TaskListHeader({
  columns,
  expandSlot,
  order,
  orderDir,
  onSort,
}: {
  columns: RowColumns;
  /** The rows reserve the subtask chevron's gutter. */
  expandSlot: boolean;
  order: TaskOrder;
  orderDir: OrderDirection;
  /** Null: the view can't sort (the Queue). */
  onSort: ((column: SortColumn) => void) | null;
}) {
  const sortCell = (column: SortColumn, label: string, className?: string, body?: ReactNode) => {
    const active = order === column;
    if (!onSort) {
      return (
        <span className={cn(LABEL, "flex shrink-0 items-center", className)}>{body ?? label}</span>
      );
    }
    return (
      <button
        type="button"
        data-sort={active ? orderDir : undefined}
        aria-label={
          active
            ? `${label}, sorted ${orderDir === "asc" ? "ascending" : "descending"}`
            : `Sort by ${label.toLowerCase()}`
        }
        onClick={() => onSort(column)}
        className={cn(
          LABEL,
          "-mx-1 flex shrink-0 items-center gap-1 rounded-sm px-1",
          "transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          active && "text-muted-foreground",
          className,
        )}
      >
        {body ?? label}
        {active ? (
          orderDir === "asc" ? (
            <ArrowUp aria-hidden className="size-icon-xs shrink-0" />
          ) : (
            <ArrowDown aria-hidden className="size-icon-xs shrink-0" />
          )
        ) : null}
      </button>
    );
  };
  const plain = (label: string, className: string) => (
    <span className={cn(LABEL, "flex shrink-0 items-center", className)}>{label}</span>
  );

  return (
    <div
      data-slot="task-list-header"
      className="flex h-(--row-h-sm) min-w-0 items-center gap-3 border border-transparent py-0.5 pr-2.5 pl-2"
    >
      {expandSlot ? <span aria-hidden className="size-4 shrink-0" /> : null}
      {/* The status icon's place. */}
      <span aria-hidden className="size-icon shrink-0" />
      {columns.handle ? <span aria-hidden className="shrink-0 min-w-(--tl-col-handle)" /> : null}
      <span className="flex min-w-0 flex-1 items-center">{sortCell("title", "Title")}</span>
      <span className="ms-auto flex shrink-0 items-center gap-3">
        {columns.hidden > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn(LABEL, "tabular-nums")}
                role="img"
                aria-label={hiddenLabel(columns.hidden)}
              >
                +{columns.hidden}
              </span>
            </TooltipTrigger>
            <TooltipContent>{hiddenLabel(columns.hidden)}</TooltipContent>
          </Tooltip>
        ) : null}
        {columns.project ? plain(COLUMN_LABELS.project, "min-w-(--tl-col-project)") : null}
        {columns.status
          ? sortCell("status", COLUMN_LABELS.status, "justify-start min-w-(--tl-col-status)")
          : null}
        {columns.priority
          ? sortCell(
              "priority",
              "Priority",
              "w-icon-sm justify-center",
              <span className="flex items-center" aria-hidden>
                <PriorityMark level="high" />
              </span>,
            )
          : null}
        {columns.energy ? <span aria-hidden className="w-icon-sm shrink-0" /> : null}
        {columns.due
          ? sortCell("due", COLUMN_LABELS.due, "justify-end min-w-(--tl-col-due)")
          : null}
        {columns.session
          ? sortCell("scheduled", COLUMN_LABELS.session, "justify-end min-w-(--tl-col-session)")
          : null}
        {columns.time ? plain(COLUMN_LABELS.time, "justify-end min-w-(--tl-col-time)") : null}
        {columns.waiting
          ? plain(COLUMN_LABELS.waiting, "min-w-(--tl-col-waiting) max-w-(--tl-col-waiting)")
          : null}
        {columns.assignee ? (
          columns.assigneeName ? (
            plain(COLUMN_LABELS.assignee, "min-w-(--tl-col-assignee)")
          ) : (
            <span aria-hidden className="size-icon shrink-0" />
          )
        ) : null}
        {columns.updated
          ? sortCell("updated", COLUMN_LABELS.updated, "justify-end min-w-(--tl-col-updated)")
          : null}
        {columns.queue ? (
          <span
            aria-hidden
            className={cn(
              "shrink-0",
              columns.queueWide ? "w-[calc(var(--icon)*2_+_0.25rem)]" : "w-icon",
            )}
          />
        ) : null}
      </span>
    </div>
  );
}

function hiddenLabel(n: number): string {
  return n === 1
    ? "1 column hidden to make room: widen the window or close a panel"
    : `${n} columns hidden to make room: widen the window or close a panel`;
}
