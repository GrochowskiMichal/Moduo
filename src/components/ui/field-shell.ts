import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/src/lib/utils";

/**
 * Shared field chrome for text-entry controls (Input, Textarea, SelectTrigger).
 * Owns the surface, border, focus/invalid/disabled states, typography and
 * radius so the three primitives stay identical. Height + horizontal padding
 * stay with each component (they differ: input/select are single-line with a
 * height token, textarea grows).
 *
 * Variants:
 * - `filled` (default) — a visible well: bg-input + hairline border. Crisp,
 *   for standalone forms.
 * - `ghost` — borderless/transparent at rest; a hairline + muted fill appear on
 *   hover, the focus ring on focus. The quiet, Linear-style inline-edit field
 *   used in the detail panel's property rows.
 * - `bare` — no chrome at all (transparent, no border/shadow); for inline title
 *   and rename editors that must look like plain text until focused.
 *
 * Focus is a modern offset-less ring (`ring-2 ring-ring/50`) — no ring-offset
 * gap. Invalid pairs a destructive border with a faint destructive ring.
 */
export const fieldShellVariants = cva(
  cn(
    "w-full min-w-0 rounded-md font-sans text-base text-foreground",
    "placeholder:text-muted-foreground",
    "outline-none transition-[color,background-color,border-color,box-shadow] duration-(--motion-fade) ease-(--ease-out)",
    "selection:bg-primary selection:text-primary-foreground",
    "focus-visible:ring-2 focus-visible:ring-ring/50",
    "disabled:cursor-not-allowed disabled:opacity-50",
    "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/40",
  ),
  {
    variants: {
      variant: {
        filled: "border border-border bg-input",
        ghost: cn(
          "border border-transparent bg-transparent",
          "hover:border-border hover:bg-muted/50",
          "focus-visible:border-border focus-visible:bg-muted/60",
        ),
        bare: "border-0 bg-transparent shadow-none",
      },
    },
    defaultVariants: {
      variant: "filled",
    },
  },
);

export type FieldShellVariant = NonNullable<
  VariantProps<typeof fieldShellVariants>["variant"]
>;
