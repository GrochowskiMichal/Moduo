import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * CollectionHeader — the header over a collection inside a detail panel or a
 * page (subtasks, linked items, attachments): label · count · one action
 * flush right (DS-6, promoted from the Tasks detail panel; visual audit §C).
 *
 * On the small control rung (`--ctrl-h-sm`), so a `+` IconButton beside it
 * lines up. The label is chrome (display face, 13 px medium, sentence case);
 * the count is the tertiary level, as the frames draw it (round-2b
 * `.shead .num`, `--text-3`). 4 px sit between the header and the rows under
 * it, so it reads as their header rather than one more row (MOD-152); only
 * when rows follow, so an empty collection ("Linked 0") ends at its header.
 * That rule is a `:has()` selector, so a caller's plain `mb-*` loses to it
 * while rows follow; space the rows instead if a caller ever needs more.
 */
function CollectionHeader({
  label,
  count,
  action,
  as: Tag = "div",
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  label: React.ReactNode;
  /** "3" or "1/3"; hidden when undefined. */
  count?: React.ReactNode;
  /** One control, flush right (usually an `IconButton size="sm"`). */
  action?: React.ReactNode;
  as?: "div" | "h2" | "h3" | "h4";
}) {
  return (
    <div
      data-slot="collection-header"
      className={cn(
        "flex h-(--ctrl-h-sm) min-w-0 items-center gap-1.5 font-display text-sm font-medium text-foreground",
        // The next sibling holds rows (an empty list or slot doesn't count).
        "[&:has(+:not(:empty))]:mb-1",
        className,
      )}
      {...props}
    >
      <Tag className="min-w-0 truncate">{label}</Tag>
      {count !== undefined && count !== null ? (
        <span className="shrink-0 font-sans font-normal text-subtle-foreground tabular-nums">
          {count}
        </span>
      ) : null}
      {action ? <span className="ms-auto flex shrink-0 items-center">{action}</span> : null}
    </div>
  );
}

export { CollectionHeader };
