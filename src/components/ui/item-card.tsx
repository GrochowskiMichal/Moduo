import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";
import { DRAG_SOURCE, DROP_TARGET } from "./drag-visuals";
import { SELECTED_OPTION } from "./selection";

/*
 * ItemCard — the kit's Card (DS-6, tasks-v3 §19; visual audit §C): one item on
 * a board column, a gallery or a lane. (The shadcn `Card` in card.tsx stays the
 * panel container.)
 *
 * - Surface: the card fill with a hairline ring, not an opaque border (an
 *   opaque border is a rumour on dark, 1.15:1).
 * - Padding is the density's small pad, so cards scale with density like rows
 *   do (call 44); before DS-6 a board card was 65 px at every density.
 * - Hover is a fill (the same language as a Row); selected is SELECTED_OPTION
 *   and hovering it steps one up; done fades to half (a state, call 38); a
 *   drop target and the drag source take the shared drag visuals. What follows
 *   the pointer while dragging is `DragOverlaySurface`, never this.
 * - Title 14 px body, wraps; one meta line under it, 12 px, indented past the
 *   lead control.
 */

type ItemCardProps = React.ComponentProps<"div"> & {
  selected?: boolean;
  done?: boolean;
  dropTarget?: boolean;
  dragging?: boolean;
  asChild?: boolean;
};

function ItemCard({
  className,
  selected = false,
  done = false,
  dropTarget = false,
  dragging = false,
  asChild = false,
  ...props
}: ItemCardProps) {
  const Comp = asChild ? Slot.Root : "div";
  return (
    <Comp
      data-slot="item-card"
      data-selected={selected ? "" : undefined}
      data-done={done ? "" : undefined}
      className={cn(
        "group/card relative flex min-w-0 flex-col gap-1 rounded-lg border border-transparent bg-card",
        "px-(--pad-x-sm) py-(--pad-y-sm) font-sans text-card-foreground outline-none",
        "ring-1 ring-hairline ring-inset",
        "transition-colors duration-(--motion-fade) ease-(--ease-out)",
        "hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring/50",
        selected && cn(SELECTED_OPTION, "hover:bg-state-selected-hover"),
        done && "opacity-50",
        dropTarget && DROP_TARGET,
        dragging && DRAG_SOURCE,
        className,
      )}
      {...props}
    />
  );
}

/** The title line: an optional lead control, then the title, which wraps. */
function ItemCardTitle({
  className,
  lead,
  children,
  ...props
}: React.ComponentProps<"div"> & { lead?: React.ReactNode }) {
  return (
    <div
      data-slot="item-card-title"
      className={cn("flex min-w-0 items-start gap-2 text-base leading-snug", className)}
      {...props}
    >
      {lead ? <span className="flex h-lh shrink-0 items-center">{lead}</span> : null}
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

/** The one meta line: 12 px secondary, indented past the lead control. */
function ItemCardMeta({
  className,
  indent = true,
  ...props
}: React.ComponentProps<"div"> & { indent?: boolean }) {
  return (
    <div
      data-slot="item-card-meta"
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground tabular-nums",
        indent && "ps-6",
        className,
      )}
      {...props}
    />
  );
}

export type { ItemCardProps };
export { ItemCard, ItemCardMeta, ItemCardTitle };
