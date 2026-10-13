import type * as React from "react";

import { cn } from "@/lib/utils";

// Skeleton — a quiet placeholder block while content loads (shadcn's skeleton).
// The pulse follows the motion tokens through Tailwind's `animate-pulse`, which
// the reduced-motion layer in tokens.css stills. Size it with the call site's
// own layout classes; it carries no dimensions of its own.

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn(
        "animate-pulse rounded-md bg-state-active motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
