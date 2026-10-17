import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A keyboard-key badge. The single source for rendering a shortcut key across
 * the app (the tasks capture hint, the email + global shortcut sheets). Kept in
 * the primitive layer so app chrome doesn't reach into a feature for it.
 */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "rounded border border-border bg-muted px-1 py-0.5 font-mono text-2xs text-muted-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
