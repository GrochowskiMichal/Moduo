import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";
import { DRAG_SOURCE, DROP_TARGET } from "./drag-visuals";
import { SELECTED_ROW } from "./selection";

/*
 * Row — the north-star list row (DS-6, tasks-v3 §19; visual audit §C). One
 * anatomy for task rows, note rows, email threads and contacts:
 *
 *   [lead control] title · quiet counts ……… [fixed columns]
 *
 * - Height is the density's `--row-h` (36 / 32 / 28), never a fixed number.
 * - States: hover is a fill (`state-hover`, the same language as cards);
 *   selected is SELECTED_ROW and hovering it steps one up; keyboard focus is
 *   the one offset-less `/50` ring; done fades every slot except the lead
 *   control (a state, not a text level, call 38); a drop target and the drag
 *   source take the shared drag visuals.
 * - The title is content (body face, `text-md`) and gives way first: it
 *   truncates before any count or column shrinks (call 42). Columns hold a
 *   fixed width so dates, times and counts never truncate (call 41).
 *
 * Pieces, not behaviour: the consumer owns selection, keyboard and drag.
 */

type RowProps = React.ComponentProps<"div"> & {
  selected?: boolean;
  done?: boolean;
  /** A drag is hovering this row and it will take the drop. */
  dropTarget?: boolean;
  /** This row is the one being dragged. */
  dragging?: boolean;
  asChild?: boolean;
};

function Row({
  className,
  selected = false,
  done = false,
  dropTarget = false,
  dragging = false,
  asChild = false,
  ...props
}: RowProps) {
  const Comp = asChild ? Slot.Root : "div";
  return (
    <Comp
      data-slot="row"
      data-selected={selected ? "" : undefined}
      data-done={done ? "" : undefined}
      className={cn(
        "group/row relative flex min-h-(--row-h) min-w-0 items-center gap-3 rounded-md border border-transparent py-0.5 pr-2.5 pl-2",
        "font-sans text-foreground outline-none",
        "transition-colors duration-(--motion-fade) ease-(--ease-out)",
        "hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring/50",
        selected && cn(SELECTED_ROW, "hover:bg-state-selected-hover"),
        dropTarget && DROP_TARGET,
        dragging && DRAG_SOURCE,
        className,
      )}
      {...props}
    />
  );
}

/** The leading control slot: a checkbox or status icon on the icon rung.
 *  It never fades with a done row, so the row can be reopened from it. */
function RowLead({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="row-lead"
      className={cn("flex size-icon shrink-0 items-center justify-center", className)}
      {...props}
    />
  );
}

const DONE_FADE = "group-data-[done]/row:opacity-50";

/** The title: body face, gives way first, struck through when done. */
function RowTitle({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="row-title"
      className={cn(
        "min-w-0 truncate text-md leading-snug",
        "group-data-[done]/row:line-through group-data-[done]/row:decoration-subtle-foreground",
        DONE_FADE,
        className,
      )}
      {...props}
    />
  );
}

/** The quiet counts after the title (put `MetaCounts` here). Never shrinks:
 *  the title truncates first, and the counts drop whole items behind "+n". */
function RowMeta({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="row-meta"
      className={cn("flex shrink-0 items-center gap-2.5", DONE_FADE, className)}
      {...props}
    />
  );
}

/** The fixed right-hand columns, pushed to the row's end. */
function RowColumns({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="row-columns"
      className={cn("ms-auto flex shrink-0 items-center gap-3", DONE_FADE, className)}
      {...props}
    />
  );
}

/**
 * One fixed column. `width` sizes it on the icon rung (`icon`, an avatar or a
 * glyph) or to its content (`auto`, e.g. a date column sized by its widest
 * value). Tabular numbers, right-aligned, never truncated.
 */
function RowColumn({
  className,
  width = "auto",
  ...props
}: React.ComponentProps<"span"> & { width?: "icon" | "auto" }) {
  return (
    <span
      data-slot="row-column"
      className={cn(
        "flex shrink-0 items-center justify-end text-xs whitespace-nowrap text-muted-foreground tabular-nums",
        width === "icon" && "size-icon justify-center",
        className,
      )}
      {...props}
    />
  );
}

export type { RowProps };
export { Row, RowColumn, RowColumns, RowLead, RowMeta, RowTitle };
