import { CornerDownRight } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/*
 * Drag visuals (DS-4) — one look for every drag in the app, whatever runs the
 * gesture (dnd-kit, the notes tree's raw pointer, a hand-rolled engine). These
 * are pieces, not behaviour: the consumer decides where a drop lands and
 * renders the matching piece.
 *
 * - `InsertionLine`: "it goes here" between two rows. A 2px accent line with a
 *   ring dot at its start, drawn on a row's top or bottom edge.
 * - `DROP_TARGET`: the thing under the pointer will take the drop (a sidebar
 *   bucket, a nest target, a board column). State-active fill plus an inset
 *   accent ring.
 * - `DRAG_SOURCE`: the item being dragged, left in place and dimmed.
 * - `DragOverlaySurface`: what follows the pointer, on the popover surface.
 * - `NestPreview`: "becomes a subtask of the row above". An indented ghost row
 *   with a dashed accent outline.
 * - `SortedNote`: the list is sorted, so this spot takes no reorder. A quiet
 *   note where the line would be.
 *
 * Drop targets and the insertion line are accent status marks (DESIGN_RULES
 * R5), so they compose `--primary` directly and never the selection recipes.
 */

/** The dimmed drag source. One value everywhere, apart from `disabled` (50). */
export const DRAG_SOURCE = "opacity-40";

/** A drop target while a drag hovers it. Compose it with `cn()` after the
 *  row's own classes: the drag overlay doesn't take pointer events, so the
 *  target row really is `:hover`, and its `hover:bg-state-hover` would
 *  otherwise beat the plain fill. The `hover:` copy here replaces it. */
export const DROP_TARGET =
  "bg-state-active hover:bg-state-active ring-1 ring-inset ring-primary/60";

type InsertionLineProps = {
  /** Which edge of the positioned parent the line sits on. */
  edge?: "top" | "bottom";
  /** Px from the parent's start edge to the line's start (the drop depth's
   *  indent). The dot sits on this point. */
  indent?: number;
  className?: string;
};

/**
 * Renders inside a `relative` row, on its top or bottom edge, spanning from
 * `indent` to the row's end. Decorative: announce the drop through the drag
 * library's live region, not this.
 */
function InsertionLine({ edge = "top", indent = 0, className }: InsertionLineProps) {
  return (
    <span
      aria-hidden
      data-slot="insertion-line"
      data-edge={edge}
      className={cn(
        "pointer-events-none absolute end-2 z-(--z-sticky) h-0",
        edge === "top" ? "top-0" : "bottom-0",
        className,
      )}
      style={{ insetInlineStart: indent }}
    >
      <span className="absolute inset-x-0 -top-px h-0.5 rounded-full bg-primary" />
      <span className="absolute -start-1.5 -top-1 size-2 rounded-full ring-2 ring-primary ring-inset" />
    </span>
  );
}

type DragOverlaySurfaceProps = React.ComponentProps<"div"> & {
  /** How many items move together; a badge shows from 2 up. */
  count?: number;
};

/** What follows the pointer: the row's content on the popover surface. Put it
 *  inside dnd-kit's `<DragOverlay>` (or any portal that tracks the pointer). */
function DragOverlaySurface({ count, className, children, ...props }: DragOverlaySurfaceProps) {
  return (
    <div
      data-slot="drag-overlay"
      className={cn(
        "pointer-events-none relative flex min-h-(--row-h) items-center gap-2.5 rounded-md border border-hairline bg-popover px-2.5 font-sans text-base text-popover-foreground shadow-lg",
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined && count > 1 ? (
        <span
          aria-hidden
          className="absolute -end-2 -top-2 inline-grid h-4 min-w-4 place-items-center rounded-full bg-foreground px-1 text-2xs font-semibold tabular-nums text-background"
        >
          {count}
        </span>
      ) : null}
    </div>
  );
}

type NestPreviewProps = React.ComponentProps<"div"> & {
  /** Px the preview is indented by: the child depth's indent. */
  indent?: number;
  /** The trailing hint. */
  hint?: React.ReactNode;
};

/** The ghost of the dragged item as a child of the row above it. */
function NestPreview({
  indent = 0,
  hint = "Make subtask",
  className,
  style,
  children,
  ...props
}: NestPreviewProps) {
  return (
    <div
      aria-hidden
      data-slot="nest-preview"
      className={cn(
        "pointer-events-none flex h-(--row-h) items-center gap-2.5 rounded-md px-2.5 font-sans text-sm text-muted-foreground",
        "outline-1 -outline-offset-1 outline-primary/60 outline-dashed",
        className,
      )}
      style={{ marginInlineStart: indent, ...style }}
      {...props}
    >
      <CornerDownRight aria-hidden className="size-icon-xs shrink-0" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span className="shrink-0 text-xs">{hint}</span> : null}
    </div>
  );
}

type SortedNoteProps = {
  /** Which edge of the positioned parent the note sits on (the line's). */
  edge?: "top" | "bottom";
  /** "Sorted by due date": why this spot takes no reorder. */
  children: React.ReactNode;
  className?: string;
};

/**
 * Where a sorted list would have drawn the insertion line: a quiet note on
 * the same edge, at the row's end, on the popover surface. The list is sorted,
 * so a reorder here can't keep its place; the drop asks to switch back to
 * manual order instead. Decorative, like the line.
 */
function SortedNote({ edge = "top", children, className }: SortedNoteProps) {
  return (
    <span
      aria-hidden
      data-slot="sorted-note"
      data-edge={edge}
      className={cn(
        "pointer-events-none absolute end-2 z-(--z-sticky) rounded-md border border-hairline bg-popover px-2 py-0.5 font-sans text-xs text-muted-foreground shadow-sm",
        edge === "top" ? "top-0 -translate-y-1/2" : "bottom-0 translate-y-1/2",
        className,
      )}
    >
      {children}
    </span>
  );
}

export type { DragOverlaySurfaceProps, InsertionLineProps, NestPreviewProps, SortedNoteProps };
export { DragOverlaySurface, InsertionLine, NestPreview, SortedNote };
