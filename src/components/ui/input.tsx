import * as React from "react";

import { cn } from "@/src/lib/utils";
import { fieldShellVariants, type FieldShellVariant } from "./field-shell";

type InputProps = Omit<React.ComponentProps<"input">, "size"> & {
  /** Surface treatment — see field-shell.ts. Default `filled`. */
  variant?: FieldShellVariant;
  /** Control height rung: `md` = --ctrl-h (default), `sm` = --ctrl-h-sm. */
  size?: "sm" | "md";
};

function Input({
  className,
  type,
  style,
  variant = "filled",
  size = "md",
  ...props
}: InputProps) {
  const heightVar = size === "sm" ? "var(--ctrl-h-sm)" : "var(--ctrl-h)";
  return (
    <input
      type={type}
      data-slot="input"
      data-size={size}
      className={cn(
        fieldShellVariants({ variant }),
        "flex",
        size === "sm" ? "px-2.5" : "px-3",
        variant === "bare" && "px-0",
        "file:inline-flex file:border-0 file:bg-transparent file:text-base file:font-medium file:text-foreground",
        className,
      )}
      style={{ height: heightVar, ...style }}
      {...props}
    />
  );
}

export { Input };
export type { InputProps };
