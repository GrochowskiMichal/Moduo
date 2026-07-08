import * as React from "react";

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
  className?: string;
};

/**
 * Centered empty/teaching state — shared across modules (Tasks lists, Notes,
 * search, etc.). Quiet by default; pass an `action` + `hint` to teach the
 * fastest path (e.g. "Press q to queue"). Generalized from the Tasks list view.
 */
function EmptyState({ icon: Icon, title, description, action, hint, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "grid h-full place-content-center justify-items-center gap-2 px-6 text-center text-muted-foreground",
        className,
      )}
    >
      {Icon ? <Icon className="size-icon-lg opacity-60" aria-hidden /> : null}
      <p className="text-sm text-foreground">{title}</p>
      {description ? <p className="max-w-xs text-xs text-muted-foreground/80">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
      {hint ? <p className="text-2xs text-muted-foreground/70">{hint}</p> : null}
    </div>
  );
}

export { EmptyState };
export type { EmptyStateProps };
