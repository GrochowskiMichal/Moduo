import type * as React from "react";

import { cn } from "@/lib/utils";

type EmptyStateProps = {
  /** Optional lucide icon shown above the title. */
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  description?: string;
  /** Primary action (usually a Button). */
  action?: React.ReactNode;
  /** Quiet teaching hint below the action (e.g. a keyboard shortcut line). */
  hint?: React.ReactNode;
  /**
   * `page` (default) centres in the whole pane; `inline` sits in a board
   * column, a timeline lane or a panel section, top-aligned with less air.
   */
  size?: "page" | "inline";
  className?: string;
};

/**
 * Centered empty/teaching state — shared across modules (Tasks lists, Notes,
 * search, etc.). Quiet by default; pass an `action` + `hint` to teach the
 * fastest path (e.g. "Press q to queue"). Generalized from the Tasks list view.
 *
 * Text sits on the three readable levels (call 38, DS-6): the title primary,
 * the description secondary, the hint and the icon tertiary. No one-off fades.
 */
function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  hint,
  size = "page",
  className,
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      data-size={size}
      className={cn(
        "grid justify-items-center gap-2 text-center text-muted-foreground",
        size === "page" ? "h-full place-content-center px-6" : "content-start px-3 py-4",
        className,
      )}
    >
      {Icon ? <Icon className="size-icon-lg text-subtle-foreground" aria-hidden /> : null}
      <p className="text-sm text-foreground">{title}</p>
      {description ? <p className="max-w-xs text-xs text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
      {hint ? <p className="text-2xs text-subtle-foreground">{hint}</p> : null}
    </div>
  );
}

export type { EmptyStateProps };
export { EmptyState };
