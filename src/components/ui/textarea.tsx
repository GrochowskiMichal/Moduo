import type * as React from "react";

import { cn } from "@/lib/utils";
import { type FieldShellVariant, fieldShellVariants } from "./field-shell";

type TextareaProps = React.ComponentProps<"textarea"> & {
  /** Surface treatment — see field-shell.ts. Default `filled`. */
  variant?: FieldShellVariant;
};

function Textarea({ className, variant = "filled", ...props }: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        fieldShellVariants({ variant }),
        "flex min-h-20 resize-y px-3 py-2",
        variant === "bare" && "resize-none px-0 py-0",
        className,
      )}
      {...props}
    />
  );
}

export type { TextareaProps };
export { Textarea };
