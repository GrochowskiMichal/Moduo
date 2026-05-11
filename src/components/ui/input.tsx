import * as React from "react";

import { cn } from "@/src/lib/utils";

function Input({ className, type, style, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex w-full min-w-0 rounded-md border border-border bg-input px-3 font-sans text-sm text-foreground",
        "placeholder:text-muted-foreground",
        "transition-colors outline-none",
        "selection:bg-primary selection:text-primary-foreground",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive",
        "file:inline-flex file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        className,
      )}
      style={{ height: "var(--ctrl-h)", ...style }}
      {...props}
    />
  );
}

export { Input };
