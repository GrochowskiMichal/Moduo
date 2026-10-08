import type * as React from "react";

import { cn } from "@/lib/utils";

// MetaCount — one quiet indicator language for rows and cards (design-state-
// layer DS-3): a 12 px icon + a number, muted, hidden at zero. Tags,
// attachments, comments and subtasks all use it, in that order, inside one
// MetaCounts group, so a row's marks always sit in the same place.

type MetaCountProps = Omit<React.ComponentProps<"span">, "children"> & {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  count: number;
  /**
   * What a screen reader hears. A string is the plural noun ("attachments"),
   * read as "<count> <noun>"; pass a function to word it yourself (singulars).
   */
  label: string | ((count: number) => string);
};

function MetaCount({ icon: Icon, count, label, className, ...props }: MetaCountProps) {
  if (!Number.isFinite(count) || count <= 0) return null;
  const spoken = typeof label === "function" ? label(count) : `${count} ${label}`;
  return (
    <span
      data-slot="meta-count"
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 font-sans text-xs tabular-nums text-muted-foreground",
        className,
      )}
      {...props}
    >
      <Icon aria-hidden className="size-icon-xs shrink-0" />
      <span aria-hidden>{count}</span>
      <span className="sr-only">{spoken}</span>
    </span>
  );
}

/** Spaces a row's or card's MetaCounts evenly. */
function MetaCounts({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="meta-counts"
      className={cn("inline-flex shrink-0 items-center gap-2.5", className)}
      {...props}
    />
  );
}

export type { MetaCountProps };
export { MetaCount, MetaCounts };
