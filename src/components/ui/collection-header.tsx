import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * CollectionHeader — the header over a collection inside a detail panel or a
 * page (subtasks, linked items, attachments): label · count · one action
 * flush right (DS-6, promoted from the Tasks detail panel; visual audit §C).
 *
 * On the small control rung (`--ctrl-h-sm`), so a `+` IconButton beside it
 * lines up. The label is chrome (display face, 13 px medium, sentence case);
 * the count is the secondary level.
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
        className,
      )}
      {...props}
    >
      <Tag className="min-w-0 truncate">{label}</Tag>
      {count !== undefined && count !== null ? (
        <span className="shrink-0 font-sans font-normal text-muted-foreground tabular-nums">
          {count}
        </span>
      ) : null}
      {action ? <span className="ms-auto flex shrink-0 items-center">{action}</span> : null}
    </div>
  );
}

export { CollectionHeader };
